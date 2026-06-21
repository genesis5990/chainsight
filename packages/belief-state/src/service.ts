/**
 * SupabaseBeliefStateService — Phase-1 v1.1 implementation of §3.
 *
 * Backed by Supabase (Postgres) for durable storage and Redis for pub/sub +
 * L2 cache. Uses the service_role key for direct writes (the worker path);
 * RLS is enforced at the database for any auth.uid()-backed callers (the
 * direct PostgREST/Realtime path).
 *
 * The class enforces tenancy at the application layer via AgencyContext
 * regardless of connection role.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgencyContext, AtomFilter, AtomPredicate, AtomStatus,
  BeliefAtom, BeliefAtomChallenge, BeliefAtomId, BeliefAtomInput,
  BeliefAtomRetraction, BeliefStateEvent, BeliefStateService,
  CaseId, ChallengeResolutionInput, EmittedByKind, SubjectRef,
  SupportingEvidence,
} from '@chainsight/shared-types';

import { MathClient, asConfidence, type CallContext } from '@chainsight/math-client';

import { BeliefError } from './errors';
import { computePayloadHash } from './hash';
import { fillConfidenceInputs, computeConfidence as computeConfidenceLocal } from './math-stub';
import { L1Cache, RedisL2Cache } from './cache';
import { BeliefPubSub } from './pubsub';
import {
  HUMAN_WRITABLE_PREDICATES, PREDICATE_PAYLOAD_SCHEMAS,
  SUPERVISOR_ONLY_PREDICATES, SYSTEM_ONLY_PREDICATES,
} from './predicates';

// ─── DB row shape ───────────────────────────────────────────────────────────
interface AtomRow {
  id: string;
  case_id: string;
  subject_ref: string;
  subject_kind: 'address' | 'tx' | 'cluster';
  predicate: string;
  object_payload: Record<string, unknown>;
  basis: 'T0' | 'T2' | 'T3';
  basis_detail: string;
  confidence: BeliefAtom['confidence'];
  supporting_evidence: SupportingEvidence[];
  emitted_by_kind: EmittedByKind;
  emitted_by_id: string;
  emitted_at: string;
  parent_atom_id: string | null;
  reproducibility_inputs: Record<string, unknown> | null;
  status: AtomStatus;
  superseded_by: string | null;
  superseded_at: string | null;
  payload_hash: string;       // postgrest returns bytea as '\x...' hex
  locked_at: string | null;
  locked_in_pack_id: string | null;
}

function detectSubjectKind(ref: SubjectRef): 'address' | 'tx' | 'cluster' {
  if (ref.startsWith('cluster:')) return 'cluster';
  if (ref.includes('_tx:')) return 'tx';
  return 'address';
}

function pgBytea(buf: Buffer): string {
  return '\\x' + buf.toString('hex');
}

function rowToAtom(row: AtomRow, challenges: BeliefAtomChallenge[] = []): BeliefAtom {
  return {
    id: row.id as unknown as BeliefAtomId,
    case_id: row.case_id as unknown as CaseId,
    subject_ref: row.subject_ref as SubjectRef,
    predicate: row.predicate as AtomPredicate,
    object_payload: row.object_payload,
    basis: row.basis,
    basis_detail: row.basis_detail,
    confidence: row.confidence,
    supporting_evidence: row.supporting_evidence ?? [],
    emitted_by_kind: row.emitted_by_kind,
    emitted_by_id: row.emitted_by_id,
    emitted_at: row.emitted_at,
    parent_atom_id: (row.parent_atom_id ?? undefined) as BeliefAtomId | undefined,
    reproducibility_inputs: row.reproducibility_inputs ?? undefined,
    status: row.status,
    superseded_by: (row.superseded_by ?? undefined) as BeliefAtomId | undefined,
    superseded_at: row.superseded_at ?? undefined,
    challenges,
    payload_hash: typeof row.payload_hash === 'string'
      ? row.payload_hash.replace(/^\\x/, '')
      : Buffer.from(row.payload_hash as unknown as Uint8Array).toString('hex'),
    locked_at: row.locked_at ?? undefined,
    locked_in_pack_id: row.locked_in_pack_id ?? undefined,
  };
}

// ─── service ────────────────────────────────────────────────────────────────

export interface SupabaseBeliefStateOptions {
  /** Service-role Supabase client (bypasses RLS). */
  serviceClient: SupabaseClient;
  /** L2 cache (Redis-backed). */
  l2Cache: RedisL2Cache;
  /** Pub/sub for streaming. */
  pubsub: BeliefPubSub;
  /**
   * Optional Math Service client. If provided, confidence math goes through
   * the live service (preferred). If omitted, the local math-stub is used.
   * The two paths produce byte-identical recipe_hash values.
   */
  mathClient?: MathClient;
  /** Override: clock for tests. */
  now?: () => Date;
}

export class SupabaseBeliefStateService implements BeliefStateService {
  private readonly db: SupabaseClient;
  private readonly l2: RedisL2Cache;
  private readonly pubsub: BeliefPubSub;
  private readonly mathClient?: MathClient;
  private readonly l1 = new L1Cache();
  private readonly now: () => Date;

  constructor(opts: SupabaseBeliefStateOptions) {
    this.db = opts.serviceClient;
    this.l2 = opts.l2Cache;
    this.pubsub = opts.pubsub;
    this.mathClient = opts.mathClient;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Compute the confidence for an emitting atom. Uses the live Math Service
   * when configured, falling back to the local stub for dev / offline.
   *
   * Parity contract: both paths produce the same recipe_hash for the same
   * inputs. Verified by the parity tests in packages/math-client/tests.
   */
  private async resolveConfidence(
    input: BeliefAtomInput,
    ctx: AgencyContext,
  ): Promise<BeliefAtom['confidence']> {
    const inputs = fillConfidenceInputs(input.basis, input.confidence_input);
    if (this.mathClient) {
      const callCtx: CallContext = {
        actor_id: ctx.user_id,
        agency_id: ctx.agency_id,
      };
      try {
        const r = await this.mathClient.computeConfidence(inputs, callCtx);
        return asConfidence(r);
      } catch (e) {
        // Math down should not silently corrupt the ledger. Surface as internal.
        throw new BeliefError('internal', `math.compute_confidence failed: ${(e as Error).message}`, e);
      }
    }
    return computeConfidenceLocal(inputs);
  }

  // ────────────────────────────────────────────────────────────────────────
  // emit
  // ────────────────────────────────────────────────────────────────────────

  async emit(input: BeliefAtomInput, ctx: AgencyContext): Promise<BeliefAtom> {
    // 1. validate predicate-specific payload
    const schema = PREDICATE_PAYLOAD_SCHEMAS[input.predicate];
    if (!schema) {
      throw new BeliefError('invalid_input', `unknown predicate '${input.predicate}'`);
    }
    const parsed = schema.safeParse(input.object_payload);
    if (!parsed.success) {
      throw new BeliefError('invalid_input', `object_payload invalid for predicate '${input.predicate}'`, parsed.error.flatten());
    }

    // 2. emitter-kind / predicate-role rules
    if (input.emitted_by_kind === 'human' && !HUMAN_WRITABLE_PREDICATES.has(input.predicate)) {
      throw new BeliefError('forbidden', `predicate '${input.predicate}' is not human-writable`);
    }
    if (SYSTEM_ONLY_PREDICATES.has(input.predicate) && input.emitted_by_kind !== 'system') {
      throw new BeliefError('forbidden', `predicate '${input.predicate}' is system-only`);
    }
    if (SUPERVISOR_ONLY_PREDICATES.has(input.predicate) && !ctx.roles.includes('supervisor') && !ctx.roles.includes('admin')) {
      throw new BeliefError('forbidden', `predicate '${input.predicate}' requires supervisor role`);
    }

    // 3. authz — caller must have write access on the case
    await this.assertCanWrite(input.case_id, ctx);

    // 4. compute confidence — live Math Service if available, stub otherwise.
    const confidence = await this.resolveConfidence(input, ctx);

    // 5. payload hash
    const payloadHash = computePayloadHash(input);

    // 6. insert + event in a single RPC (function below) to keep both
    //    rows in one transaction.
    const subjectKind = detectSubjectKind(input.subject_ref);

    const { data, error } = await this.db.schema('belief').rpc('insert_atom_with_event', {
      p_case_id: input.case_id,
      p_subject_ref: input.subject_ref,
      p_subject_kind: subjectKind,
      p_predicate: input.predicate,
      p_object_payload: parsed.data,
      p_basis: input.basis,
      p_basis_detail: input.basis_detail,
      p_confidence: confidence as unknown as Record<string, unknown>,
      p_supporting_evidence: input.supporting_evidence ?? [],
      p_emitted_by_kind: input.emitted_by_kind,
      p_emitted_by_id: input.emitted_by_id,
      p_parent_atom_id: input.parent_atom_id ?? null,
      p_reproducibility_inputs: input.reproducibility_inputs ?? null,
      p_payload_hash: pgBytea(payloadHash),
    });

    if (error) {
      throw new BeliefError('internal', `insert_atom_with_event failed: ${error.message}`, error);
    }

    const row = (Array.isArray(data) ? data[0] : data) as { atom: AtomRow; case_seq: number };
    const atom = rowToAtom(row.atom);
    this.l1.put(atom);

    // 7. invalidate L2 cache for this case (writes touched it)
    await this.l2.invalidateAtomsForCase(input.case_id);

    // 8. publish event (best-effort, never aborts the write)
    await this.pubsub.publish(input.case_id, {
      kind: 'atom_emitted',
      case_seq: row.case_seq,
      atom,
    });

    return atom;
  }

  // ────────────────────────────────────────────────────────────────────────
  // challenge / resolve / supersede / retract / linkEvidence
  // ────────────────────────────────────────────────────────────────────────

  async challenge(atomId: BeliefAtomId, reason: string, ctx: AgencyContext): Promise<BeliefAtomChallenge> {
    const atom = await this.getAtom(atomId, ctx);
    if (!atom) throw new BeliefError('not_found', `atom ${atomId} not found`);
    if (atom.locked_at) throw new BeliefError('evidence_immutable', 'atom is locked in a finalized pack');
    await this.assertCanWrite(atom.case_id, ctx);

    const { data, error } = await this.db
      .schema('belief')
      .from('atom_challenges')
      .insert({
        atom_id: atomId,
        case_id: atom.case_id,
        reason,
        challenged_by: ctx.user_id,
      })
      .select('*')
      .single();

    if (error) throw new BeliefError('internal', `challenge insert failed: ${error.message}`, error);

    // status flip
    const { error: updErr } = await this.db
      .schema('belief')
      .from('atoms')
      .update({ status: 'challenged' })
      .eq('id', atomId)
      .is('locked_at', null);
    if (updErr) throw new BeliefError('internal', `atom status update failed: ${updErr.message}`, updErr);

    const challenge = data as BeliefAtomChallenge;
    await this.l2.invalidateAtomsForCase(atom.case_id);
    const seq = await this.bumpCaseSeq(atom.case_id);
    await this.pubsub.publish(atom.case_id, { kind: 'atom_challenged', case_seq: seq, challenge });
    return challenge;
  }

  async resolveChallenge(
    challengeId: string,
    resolution: ChallengeResolutionInput,
    ctx: AgencyContext,
  ): Promise<BeliefAtomChallenge> {
    const { data: chRow, error: chErr } = await this.db
      .schema('belief')
      .from('atom_challenges')
      .select('*')
      .eq('id', challengeId)
      .single();
    if (chErr || !chRow) throw new BeliefError('not_found', `challenge ${challengeId} not found`);

    const ch = chRow as BeliefAtomChallenge;
    await this.assertCanWrite(ch.case_id, ctx);
    if (ch.resolved_at) throw new BeliefError('conflict', 'challenge already resolved');

    const { data, error } = await this.db
      .schema('belief')
      .from('atom_challenges')
      .update({
        resolution: resolution.resolution,
        resolution_note: resolution.note,
        resolved_by: ctx.user_id,
        resolved_at: this.now().toISOString(),
      })
      .eq('id', challengeId)
      .select('*')
      .single();
    if (error) throw new BeliefError('internal', `challenge resolution failed: ${error.message}`, error);

    // If upheld → re-assert. If withdrawn → re-assert.
    // If superseded → caller MUST also pass a superseding atom (handled separately via supersede()).
    if (resolution.resolution === 'upheld' || resolution.resolution === 'withdrawn') {
      await this.db
        .schema('belief')
        .from('atoms')
        .update({ status: 'asserted' })
        .eq('id', ch.atom_id)
        .is('locked_at', null);
    }

    const resolved = data as BeliefAtomChallenge;
    await this.l2.invalidateAtomsForCase(ch.case_id);
    const seq = await this.bumpCaseSeq(ch.case_id);
    await this.pubsub.publish(ch.case_id, { kind: 'atom_resolved', case_seq: seq, challenge: resolved });
    return resolved;
  }

  async supersede(
    oldAtomId: BeliefAtomId,
    newAtomInput: BeliefAtomInput,
    ctx: AgencyContext,
  ): Promise<BeliefAtom> {
    const old = await this.getAtom(oldAtomId, ctx);
    if (!old) throw new BeliefError('not_found', `atom ${oldAtomId} not found`);
    if (old.locked_at) throw new BeliefError('evidence_immutable', 'atom is locked in a finalized pack');
    if (old.case_id !== newAtomInput.case_id) {
      throw new BeliefError('invalid_input', 'superseding atom must be in the same case');
    }

    // Emit the new atom first
    const newAtom = await this.emit(newAtomInput, ctx);

    // Mark the old superseded
    const { error: updErr } = await this.db
      .schema('belief')
      .from('atoms')
      .update({ status: 'superseded', superseded_by: newAtom.id, superseded_at: this.now().toISOString() })
      .eq('id', oldAtomId)
      .is('locked_at', null);
    if (updErr) throw new BeliefError('internal', `supersede update failed: ${updErr.message}`, updErr);

    await this.l2.invalidateAtomsForCase(newAtom.case_id);
    const seq = await this.bumpCaseSeq(newAtom.case_id);
    await this.pubsub.publish(newAtom.case_id, {
      kind: 'atom_superseded',
      case_seq: seq,
      old_atom_id: oldAtomId,
      new_atom: newAtom,
    });
    return newAtom;
  }

  async retract(atomId: BeliefAtomId, reason: string, ctx: AgencyContext): Promise<BeliefAtomRetraction> {
    const atom = await this.getAtom(atomId, ctx);
    if (!atom) throw new BeliefError('not_found', `atom ${atomId} not found`);
    if (atom.locked_at) throw new BeliefError('evidence_immutable', 'atom is locked in a finalized pack');
    await this.assertCanWrite(atom.case_id, ctx);

    const { data, error } = await this.db
      .schema('belief')
      .from('atom_retractions')
      .insert({ atom_id: atomId, case_id: atom.case_id, reason, retracted_by: ctx.user_id })
      .select('*')
      .single();
    if (error) throw new BeliefError('internal', `retraction insert failed: ${error.message}`, error);

    await this.db
      .schema('belief')
      .from('atoms')
      .update({ status: 'retracted' })
      .eq('id', atomId)
      .is('locked_at', null);

    const retraction = data as BeliefAtomRetraction;
    await this.l2.invalidateAtomsForCase(atom.case_id);
    const seq = await this.bumpCaseSeq(atom.case_id);
    await this.pubsub.publish(atom.case_id, { kind: 'atom_retracted', case_seq: seq, retraction });
    return retraction;
  }

  async linkEvidence(
    atomId: BeliefAtomId,
    evidence: SupportingEvidence,
    ctx: AgencyContext,
  ): Promise<BeliefAtom> {
    const atom = await this.getAtom(atomId, ctx);
    if (!atom) throw new BeliefError('not_found', `atom ${atomId} not found`);
    await this.assertCanWrite(atom.case_id, ctx);

    if (atom.locked_at) {
      // Spec §3.8: locked atoms cannot mutate evidence; emit a parented confidence-score atom.
      const newConfidence = await this.resolveConfidence(
        {
          case_id: atom.case_id,
          subject_ref: atom.subject_ref,
          predicate: 'has_confidence_score',
          object_payload: {},
          basis: atom.basis,
          basis_detail: 'evidence link recompute',
          confidence_input: atom.confidence.inputs,
          emitted_by_kind: 'system',
          emitted_by_id: ctx.user_id,
        },
        ctx,
      );
      return await this.emit(
        {
          case_id: atom.case_id,
          subject_ref: atom.subject_ref,
          predicate: 'has_confidence_score',
          object_payload: {
            target_atom_id: atom.id,
            recipe_hash: newConfidence.recipe_hash,
            value: newConfidence.value,
            note: 'evidence linked to locked atom; new confidence atom emitted',
          },
          basis: atom.basis,
          basis_detail: `linked evidence: ${evidence.label}`,
          emitted_by_kind: 'system',
          emitted_by_id: ctx.user_id,
          parent_atom_id: atom.id,
        },
        ctx,
      );
    }

    const nextEvidence = [...(atom.supporting_evidence ?? []), evidence];
    const { data, error } = await this.db
      .schema('belief')
      .from('atoms')
      .update({ supporting_evidence: nextEvidence })
      .eq('id', atomId)
      .is('locked_at', null)
      .select('*')
      .single();
    if (error) throw new BeliefError('internal', `evidence link failed: ${error.message}`, error);

    const updated = rowToAtom(data as AtomRow);
    this.l1.put(updated);
    await this.l2.invalidateAtomsForCase(updated.case_id);
    const seq = await this.bumpCaseSeq(updated.case_id);
    await this.pubsub.publish(updated.case_id, {
      kind: 'evidence_linked',
      case_seq: seq,
      atom_id: updated.id,
      evidence,
    });
    return updated;
  }

  // ────────────────────────────────────────────────────────────────────────
  // reads
  // ────────────────────────────────────────────────────────────────────────

  async getAtom(atomId: BeliefAtomId, ctx: AgencyContext): Promise<BeliefAtom | null> {
    const l1Hit = this.l1.get(atomId);
    if (l1Hit) {
      await this.assertCanRead(l1Hit.case_id, ctx);
      return l1Hit;
    }
    const l2Hit = await this.l2.getAtom(atomId);
    if (l2Hit) {
      await this.assertCanRead(l2Hit.case_id, ctx);
      this.l1.put(l2Hit);
      return l2Hit;
    }
    const { data, error } = await this.db
      .schema('belief')
      .from('atoms')
      .select('*')
      .eq('id', atomId)
      .maybeSingle();
    if (error) throw new BeliefError('internal', `atom read failed: ${error.message}`, error);
    if (!data) return null;

    const atom = rowToAtom(data as AtomRow);
    await this.assertCanRead(atom.case_id, ctx);
    this.l1.put(atom);
    await this.l2.putAtom(atom);
    return atom;
  }

  async queryAtoms(filter: AtomFilter, ctx: AgencyContext): Promise<BeliefAtom[]> {
    await this.assertCanRead(filter.case_id, ctx);

    let q = this.db.schema('belief').from('atoms').select('*').eq('case_id', filter.case_id);
    if (filter.subject_ref)   q = q.eq('subject_ref', filter.subject_ref);
    if (filter.subject_kind)  q = q.eq('subject_kind', filter.subject_kind);
    if (filter.predicate) {
      q = Array.isArray(filter.predicate) ? q.in('predicate', filter.predicate) : q.eq('predicate', filter.predicate);
    }
    if (filter.status) {
      q = Array.isArray(filter.status) ? q.in('status', filter.status) : q.eq('status', filter.status);
    }
    if (filter.emitted_by_kind) q = q.eq('emitted_by_kind', filter.emitted_by_kind);
    if (filter.emitted_since)   q = q.gte('emitted_at', filter.emitted_since);

    const limit = Math.min(filter.limit ?? 100, 500);
    q = q.order('emitted_at', { ascending: false }).range(filter.offset ?? 0, (filter.offset ?? 0) + limit - 1);

    const { data, error } = await q;
    if (error) throw new BeliefError('internal', `queryAtoms failed: ${error.message}`, error);

    const atoms = (data as AtomRow[] ?? []).map((r) => rowToAtom(r));
    this.l1.putMany(atoms);
    return atoms;
  }

  async getAtomsBySubject(subjectRef: SubjectRef, caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtom[]> {
    await this.assertCanRead(caseId, ctx);
    const l2Hit = await this.l2.getBySubject(caseId, subjectRef);
    if (l2Hit) {
      this.l1.putMany(l2Hit);
      return l2Hit;
    }
    const atoms = await this.queryAtoms({ case_id: caseId, subject_ref: subjectRef, limit: 500 }, ctx);
    await this.l2.putBySubject(caseId, subjectRef, atoms);
    return atoms;
  }

  async getAtomsByCase(caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtom[]> {
    return this.queryAtoms({ case_id: caseId, limit: 500 }, ctx);
  }

  async getOpenChallenges(caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtomChallenge[]> {
    await this.assertCanRead(caseId, ctx);
    const { data, error } = await this.db
      .schema('belief')
      .from('atom_challenges')
      .select('*')
      .eq('case_id', caseId)
      .is('resolved_at', null)
      .order('challenged_at', { ascending: false });
    if (error) throw new BeliefError('internal', `open challenges read failed: ${error.message}`, error);
    return (data ?? []) as BeliefAtomChallenge[];
  }

  async getEventsSince(caseId: CaseId, sinceSeq: number, ctx: AgencyContext): Promise<BeliefStateEvent[]> {
    await this.assertCanRead(caseId, ctx);
    const { data, error } = await this.db
      .schema('belief')
      .from('events')
      .select('payload, case_seq')
      .eq('case_id', caseId)
      .gt('case_seq', sinceSeq)
      .order('case_seq', { ascending: true })
      .limit(1000);
    if (error) throw new BeliefError('internal', `events read failed: ${error.message}`, error);
    return (data ?? []).map((r) => ({ ...(r.payload as object), case_seq: r.case_seq }) as BeliefStateEvent);
  }

  // ────────────────────────────────────────────────────────────────────────
  // streaming
  // ────────────────────────────────────────────────────────────────────────

  async *subscribe(caseId: CaseId, ctx: AgencyContext): AsyncIterable<BeliefStateEvent> {
    await this.assertCanRead(caseId, ctx);

    // Emit a snapshot marker FIRST so the subscriber can backfill.
    const currentSeq = await this.peekCaseSeq(caseId);
    yield { kind: 'snapshot_marker', case_seq: currentSeq, case_id: caseId };

    for await (const ev of this.pubsub.subscribe(caseId)) {
      yield ev;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────────────

  private async assertCanRead(caseId: CaseId, ctx: AgencyContext): Promise<void> {
    if (ctx.roles.includes('admin')) return;
    const { data, error } = await this.db
      .schema('belief')
      .from('case_acl')
      .select('can_read')
      .eq('case_id', caseId)
      .eq('user_id', ctx.user_id)
      .maybeSingle();
    if (error) throw new BeliefError('internal', `acl read failed: ${error.message}`, error);
    if (!data || !data.can_read) {
      throw new BeliefError('forbidden', `no read access to case ${caseId}`);
    }
  }

  private async assertCanWrite(caseId: CaseId, ctx: AgencyContext): Promise<void> {
    if (ctx.roles.includes('admin')) return;
    const { data, error } = await this.db
      .schema('belief')
      .from('case_acl')
      .select('can_write')
      .eq('case_id', caseId)
      .eq('user_id', ctx.user_id)
      .maybeSingle();
    if (error) throw new BeliefError('internal', `acl write check failed: ${error.message}`, error);
    if (!data || !data.can_write) {
      throw new BeliefError('forbidden', `no write access to case ${caseId}`);
    }
  }

  private async peekCaseSeq(caseId: CaseId): Promise<number> {
    const { data } = await this.db
      .schema('belief')
      .from('case_event_seq')
      .select('next_seq')
      .eq('case_id', caseId)
      .maybeSingle();
    if (!data) return 0;
    return ((data.next_seq as number) ?? 1) - 1;
  }

  private async bumpCaseSeq(caseId: CaseId): Promise<number> {
    // Server-side function — avoids races by using INSERT … ON CONFLICT … UPDATE
    const { data, error } = await this.db.schema('belief').rpc('bump_case_seq', { p_case_id: caseId });
    if (error) throw new BeliefError('internal', `seq bump failed: ${error.message}`, error);
    return data as number;
  }
}

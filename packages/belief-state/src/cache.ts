/**
 * Two-tier cache for the Belief State Service (v1.1 §3.9).
 *
 *   L1: per-instance Map<string, T>     — request-scoped
 *   L2: Redis  ('bs:atom:{id}' etc.)    — 60-second TTL, case-scoped keys
 *
 * Writes invalidate both tiers by case_id (so a tenant write never leaks
 * stale rows into another tenant's read).
 */

import type Redis from 'ioredis';
import type { BeliefAtom, BeliefAtomId, CaseId, SubjectRef } from '@chainsight/shared-types';

const L2_TTL_SECONDS = 60;

export interface BeliefCache {
  getAtom(id: BeliefAtomId): Promise<BeliefAtom | undefined>;
  putAtom(atom: BeliefAtom): Promise<void>;
  invalidateAtomsForCase(caseId: CaseId): Promise<void>;

  getBySubject(caseId: CaseId, subjectRef: SubjectRef): Promise<BeliefAtom[] | undefined>;
  putBySubject(caseId: CaseId, subjectRef: SubjectRef, atoms: BeliefAtom[]): Promise<void>;
}

export interface CacheOptions {
  redis: Redis;
  /** A short string namespacing this deployment, e.g. 'dev' or 'prod'. */
  namespace?: string;
}

/**
 * Per-request L1 cache. Construct one per request handler.
 */
export class L1Cache {
  private atoms = new Map<BeliefAtomId, BeliefAtom>();

  get(id: BeliefAtomId): BeliefAtom | undefined { return this.atoms.get(id); }
  put(atom: BeliefAtom): void { this.atoms.set(atom.id, atom); }
  putMany(atoms: BeliefAtom[]): void { for (const a of atoms) this.atoms.set(a.id, a); }
  clear(): void { this.atoms.clear(); }
}

export class RedisL2Cache implements BeliefCache {
  private readonly redis: Redis;
  private readonly ns: string;

  constructor(opts: CacheOptions) {
    this.redis = opts.redis;
    this.ns = opts.namespace ?? 'dev';
  }

  private atomKey(id: BeliefAtomId): string {
    return `bs:${this.ns}:atom:${id}`;
  }

  private subjectKey(caseId: CaseId, subjectRef: SubjectRef): string {
    return `bs:${this.ns}:subj:${caseId}:${subjectRef}`;
  }

  private caseSubjectSetKey(caseId: CaseId): string {
    return `bs:${this.ns}:subj-keys:${caseId}`;
  }

  private caseAtomSetKey(caseId: CaseId): string {
    return `bs:${this.ns}:atom-keys:${caseId}`;
  }

  async getAtom(id: BeliefAtomId): Promise<BeliefAtom | undefined> {
    const raw = await this.redis.get(this.atomKey(id));
    if (!raw) return undefined;
    try { return JSON.parse(raw) as BeliefAtom; }
    catch { return undefined; }
  }

  async putAtom(atom: BeliefAtom): Promise<void> {
    const k = this.atomKey(atom.id);
    const setKey = this.caseAtomSetKey(atom.case_id);
    await this.redis
      .multi()
      .set(k, JSON.stringify(atom), 'EX', L2_TTL_SECONDS)
      .sadd(setKey, k)
      .expire(setKey, L2_TTL_SECONDS * 2)
      .exec();
  }

  async getBySubject(caseId: CaseId, subjectRef: SubjectRef): Promise<BeliefAtom[] | undefined> {
    const raw = await this.redis.get(this.subjectKey(caseId, subjectRef));
    if (!raw) return undefined;
    try { return JSON.parse(raw) as BeliefAtom[]; }
    catch { return undefined; }
  }

  async putBySubject(
    caseId: CaseId,
    subjectRef: SubjectRef,
    atoms: BeliefAtom[],
  ): Promise<void> {
    const k = this.subjectKey(caseId, subjectRef);
    const setKey = this.caseSubjectSetKey(caseId);
    await this.redis
      .multi()
      .set(k, JSON.stringify(atoms), 'EX', L2_TTL_SECONDS)
      .sadd(setKey, k)
      .expire(setKey, L2_TTL_SECONDS * 2)
      .exec();
  }

  /**
   * Drop every cached atom + subject query for a case. Called on any write
   * that may invalidate (emit / supersede / retract / linkEvidence).
   */
  async invalidateAtomsForCase(caseId: CaseId): Promise<void> {
    const subjSetKey = this.caseSubjectSetKey(caseId);
    const atomSetKey = this.caseAtomSetKey(caseId);

    // Fetch the tracked keys and drop them.
    const [subjKeys, atomKeys] = await Promise.all([
      this.redis.smembers(subjSetKey),
      this.redis.smembers(atomSetKey),
    ]);

    const all = [...subjKeys, ...atomKeys, subjSetKey, atomSetKey];
    if (all.length > 0) {
      await this.redis.del(...all);
    }
  }
}

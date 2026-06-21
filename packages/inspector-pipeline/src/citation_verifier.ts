/**
 * Citation Verifier (v1.1 §5.4).
 *
 * Parses an LLM narrative for ⟦atom:id⟧ markers, checks each id against the
 * set of atoms the pipeline emitted into the case ledger, and classifies
 * every sentence as one of:
 *
 *   verified         - at least one cited atom_id exists in this case
 *   uncited          - no markers present
 *   unknown_atom     - marker present but the id doesn't resolve
 *   cross_case_atom  - id resolves but in a different case (a hard fail)
 *
 * Sentence boundary detection: we split on newline OR sentence-final
 * punctuation (.?!) followed by whitespace/EOL. The LLM stub emits one
 * sentence per line so the parser is deterministic.
 */

import type {
  BeliefAtomId,
  CaseId,
  PipelineInspectorCitationFinding,
  PipelineInspectorCitations,
} from '@chainsight/shared-types';

// Matches "⟦atom:01HXY…⟧" — the LLM stub emits the brackets verbatim.
// We accept any [0-9a-fA-F-]+ id so we can flag malformed/short ids as
// 'unknown_atom' rather than silently treating the sentence as uncited.
const ATOM_MARKER_RE = /\u27e6atom:([0-9a-zA-Z-]+)\u27e7/g;

export interface AtomIndexEntry {
  atom_id: BeliefAtomId;
  case_id: CaseId;
}

export interface VerifyInputs {
  narrative: string;
  case_id: CaseId;
  /** Atoms emitted by THIS pipeline run. */
  emitted: AtomIndexEntry[];
  /** Optional: atoms previously emitted in this case (for cross-run continuity). */
  case_atoms?: AtomIndexEntry[];
}

export function splitSentences(narrative: string): string[] {
  if (!narrative) return [];
  // First split on line breaks (the stub uses one sentence per line).
  const lines = narrative.split('\n').map((l) => l.trim()).filter(Boolean);
  // If only one line, fall back to punctuation-aware split.
  if (lines.length > 1) return lines;
  const out: string[] = [];
  const re = /[^.?!]+(?:[.?!]+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(narrative)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

export function verifyCitations(inputs: VerifyInputs): PipelineInspectorCitations {
  const sentences = splitSentences(inputs.narrative);
  const known = new Map<string, AtomIndexEntry>();
  for (const a of inputs.emitted) known.set(a.atom_id, a);
  if (inputs.case_atoms) for (const a of inputs.case_atoms) known.set(a.atom_id, a);

  const findings: PipelineInspectorCitationFinding[] = [];
  let verified = 0;
  let uncited = 0;
  let unknown_atom = 0;
  let cross_case_atom = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i] ?? '';
    const ids: BeliefAtomId[] = [];
    let match: RegExpExecArray | null;
    // reset lastIndex per loop because the regex is /g-flagged
    ATOM_MARKER_RE.lastIndex = 0;
    while ((match = ATOM_MARKER_RE.exec(sentence)) !== null) {
      if (match[1]) ids.push(match[1] as BeliefAtomId);
    }

    if (ids.length === 0) {
      uncited += 1;
      findings.push({
        sentence_index: i,
        sentence_text: sentence,
        cited_atom_ids: [],
        status: 'uncited',
        reason: 'No ⟦atom:id⟧ marker present.',
      });
      continue;
    }

    // Resolve each id
    let cross = false;
    let unknown = false;
    for (const id of ids) {
      const entry = known.get(id);
      if (!entry) { unknown = true; continue; }
      if (entry.case_id !== inputs.case_id) { cross = true; continue; }
    }

    if (cross) {
      cross_case_atom += 1;
      findings.push({
        sentence_index: i,
        sentence_text: sentence,
        cited_atom_ids: ids,
        status: 'cross_case_atom',
        reason: 'Citation references an atom belonging to a different case.',
      });
      continue;
    }
    if (unknown) {
      unknown_atom += 1;
      findings.push({
        sentence_index: i,
        sentence_text: sentence,
        cited_atom_ids: ids,
        status: 'unknown_atom',
        reason: 'Citation references an atom_id that could not be resolved.',
      });
      continue;
    }
    verified += 1;
    findings.push({
      sentence_index: i,
      sentence_text: sentence,
      cited_atom_ids: ids,
      status: 'verified',
    });
  }

  return {
    total_sentences: sentences.length,
    verified,
    uncited,
    unknown_atom,
    cross_case_atom,
    findings,
  };
}

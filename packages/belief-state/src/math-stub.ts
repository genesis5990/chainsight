/**
 * Confidence math — local stub until the Math Service ships in Week 2.
 *
 * Mirrors v1.1 §4.5. When `MATH_URL` is set in the environment, the runtime
 * MUST swap this stub for the real gRPC client. The stub keeps Phase-1 week-1
 * unblocked and is exercised by the same recipe_hash contract.
 */

import { blake3 } from '@noble/hashes/blake3';
import type { Confidence, ConfidenceInputs } from '@chainsight/shared-types';
import { canonicalJsonStringify } from './hash';

/** Pinned with the confidence math code path. Bump on formula change. */
const CONFIDENCE_FORMULA_VERSION = 'confidence@v1.0.0';

const DEFAULT_INPUTS: ConfidenceInputs = {
  basis_tier: 'T2',
  provider_corroboration_count: 0,
  sanctions_match: false,
  obfuscation_penalty: 0,
  age_decay: 0,
};

export function fillConfidenceInputs(
  basis: 'T0' | 'T2' | 'T3',
  partial?: Partial<ConfidenceInputs>,
): ConfidenceInputs {
  return {
    ...DEFAULT_INPUTS,
    basis_tier: basis,
    ...(partial ?? {}),
  };
}

export function computeConfidence(inputs: ConfidenceInputs): Confidence {
  const w = {
    basis: { T0: 0.50, T2: 0.30, T3: 0.10 } as Record<'T0' | 'T2' | 'T3', number>,
    corroboration_step: 0.02,
    corroboration_cap: 0.10,
    sanctions: 0.05,
    obfuscation: -0.10,
    age_decay: -0.05,
  };

  let value: number = w.basis[inputs.basis_tier];
  value += Math.min(w.corroboration_cap, inputs.provider_corroboration_count * w.corroboration_step);
  if (inputs.sanctions_match) value += w.sanctions;
  value += w.obfuscation * inputs.obfuscation_penalty;
  value += w.age_decay * inputs.age_decay;
  value = Math.max(0, Math.min(1, value));

  const recipe_input = { v: CONFIDENCE_FORMULA_VERSION, inputs };
  const recipe_hash = Buffer.from(
    blake3(canonicalJsonStringify(recipe_input)),
  ).toString('hex');

  return { value, inputs, recipe_hash };
}

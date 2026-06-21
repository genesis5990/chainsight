/**
 * Confidence math — local stub that mirrors apps/math/src/chainsight_math/
 * confidence.py exactly. Parity contract verified by the live_parity tests
 * in packages/math-client. When MATH_URL is set, the runtime swaps to the
 * live service — both paths produce byte-identical recipe_hash for the
 * same inputs.
 *
 * Spec: docs/chainsight_v1_1_technical_core_spec.md §4.5.
 */

import { blake3 } from '@noble/hashes/blake3';
import type { Confidence, ConfidenceInputs } from '@chainsight/shared-types';
import { canonicalJsonStringify } from './hash';

/**
 * Pinned with the confidence math code path. Bump on formula change.
 * MUST match CODE_VERSION in apps/math/src/chainsight_math/confidence.py.
 */
const CONFIDENCE_FORMULA_VERSION = 'confidence@v1.0.0';

/**
 * Hash algorithm pin — MUST match HASH_ALGO_VERSION in
 * apps/math/src/chainsight_math/recipe.py.
 */
const HASH_ALGO_VERSION = 'blake3-256@v1';

/**
 * Produce a recipe_hash that mirrors apps/math/src/chainsight_math/recipe.py
 * compute_recipe_hash() exactly. Envelope is
 *   { algo, formula, inputs, version }
 * (canonical-JSON sorts keys, so the actual emission order is alphabetical).
 */
function recipeHash(formula: string, version: string, inputs: unknown): string {
  const envelope = {
    algo: HASH_ALGO_VERSION,
    formula,
    inputs,
    version,
  };
  return Buffer.from(blake3(canonicalJsonStringify(envelope))).toString('hex');
}

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

  // Match Python exactly: obfuscation_penalty / age_decay are stringified
  // because the Python implementation uses Decimal(str(...)) which keeps the
  // exact lexical form. For our 0.0 default + integer-corro case the stringy
  // form of 0 (which is '0' in Python's str(0.0) = '0.0' but Decimal(str(0.0))
  // is '0.0') needs special handling. We coerce to '0' / '1' / etc to match
  // Python's Decimal-then-back-to-str behaviour. See parity tests.
  const recipeInputs = {
    age_decay: pythonFloatStr(inputs.age_decay),
    basis_tier: inputs.basis_tier,
    obfuscation_penalty: pythonFloatStr(inputs.obfuscation_penalty),
    provider_corroboration_count: inputs.provider_corroboration_count,
    sanctions_match: inputs.sanctions_match,
  };
  const recipe_hash = recipeHash('confidence', CONFIDENCE_FORMULA_VERSION, recipeInputs);

  return { value, inputs, recipe_hash };
}

/**
 * Mirror Python's `str(float)` lexical form for the values we know we'll
 * encounter (0..1 floats from confidence inputs). 0.0 stringifies as '0.0'
 * in Python; 1.5 as '1.5'; integers as 'N.0'.
 */
function pythonFloatStr(n: number): string {
  if (Number.isInteger(n)) return `${n}.0`;
  return String(n);
}

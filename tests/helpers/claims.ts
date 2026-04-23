// Schema for pedagogical claims extracted from each simulation's insight
// panels and accompanying .docx lesson plans. Tests use these to assert
// that the numbers shown/stated to students actually hold.

export type ClaimType = 'formula' | 'invariant' | 'literal';

export interface Claim {
  /** Unique identifier, e.g. "mangoes-eoq-phase1". */
  id: string;
  /** Phase the claim applies to, if the sim has phases. */
  phase?: number;
  /** Where the claim comes from. */
  source: 'insight' | 'docx';
  /** Human-readable restatement of the claim for the test name. */
  statement: string;
  type: ClaimType;

  /** For type='formula': the formula expression using whitelisted tokens. */
  formula?: string;
  /** For type='formula': input values for the formula's named variables. */
  inputs?: Record<string, number>;
  /** For type='formula' or 'literal': the expected numeric (or string) value. */
  expected?: number | string;
  /** For type='formula': absolute tolerance around `expected`. */
  tolerance?: number;

  /** For type='invariant': short human-readable assertion description. */
  assertion?: string;
}

export interface ClaimsFile {
  simulation: string;
  claims: Claim[];
}

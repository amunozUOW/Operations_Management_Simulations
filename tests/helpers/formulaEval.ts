// Safe-ish whitelisted arithmetic evaluator for claim formulas stored in JSON.
// Only permits: named numeric inputs, numeric literals, arithmetic, parentheses,
// and a tiny whitelist of Math functions.

const MATH_WHITELIST = new Set(['sqrt', 'exp', 'abs', 'min', 'max', 'pow', 'log']);

export function evalFormula(formula: string, inputs: Record<string, number>): number {
  const safe = formula.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (match) => {
    if (match in inputs) return String(inputs[match]);
    if (MATH_WHITELIST.has(match)) return 'Math.' + match;
    throw new Error(`Unknown symbol in formula: ${match}`);
  });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('"use strict"; return (' + safe + ');');
  return fn() as number;
}

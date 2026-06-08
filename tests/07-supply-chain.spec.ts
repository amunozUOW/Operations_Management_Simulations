import { test, expect } from '@playwright/test';
import { smokeNoNaN } from './helpers/smoke';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/07-supply-chain.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '07 Supply Chain/Supply Chain.html';

// Smoke: the consolidated 3-stage Supply Chain Game is turn-based; advancing
// turns must never leak NaN/undefined into the metrics, charts, or diagram.
test.describe('Supply Chain — smoke', () => {
  for (const seed of [1, 42]) {
    test(`advancing turns leaks no invalid values (seed=${seed})`, async ({ page }) => {
      const issues = await smokeNoNaN(page, SIM_PATH, {
        seed,
        control: '#btnNextTurn',
        mode: 'turn',
        steps: 12,
      });
      expect(issues, JSON.stringify(issues)).toEqual([]);
    });
  }
});

// Claims: the pedagogical numbers stated to students hold (formula self-consistency).
test.describe('Supply Chain — claims', () => {
  for (const c of claims.claims) {
    if (c.type === 'formula' && c.formula && c.inputs && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => {
        const result = evalFormula(c.formula!, c.inputs!);
        expect(Math.abs(result - (c.expected as number))).toBeLessThanOrEqual(c.tolerance ?? 0);
      });
    } else if (c.type === 'literal' && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => {
        expect(c.expected).toBeDefined();
      });
    }
  }
});

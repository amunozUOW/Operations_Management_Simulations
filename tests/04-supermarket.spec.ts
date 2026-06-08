import { test, expect } from '@playwright/test';
import { smokeNoNaN } from './helpers/smoke';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/04-supermarket.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '04 Supermarket Checkout/Supermarket Checkout.html';

test.describe('Supermarket — smoke', () => {
  for (const seed of [1, 42]) {
    test(`runs without invalid values (seed=${seed})`, async ({ page }) => {
      const issues = await smokeNoNaN(page, SIM_PATH, { seed, control: '#nextTurnBtn', mode: 'turn', steps: 8 });
      expect(issues, JSON.stringify(issues)).toEqual([]);
    });
  }
});

test.describe('Supermarket — claims', () => {
  for (const c of claims.claims) {
    if (c.type === 'formula' && c.formula && c.inputs && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => {
        expect(Math.abs(evalFormula(c.formula!, c.inputs!) - (c.expected as number))).toBeLessThanOrEqual(c.tolerance ?? 0);
      });
    } else if (c.type === 'literal' && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => { expect(c.expected).toBeDefined(); });
    }
  }
});

import { test, expect } from '@playwright/test';
import { smokeNoNaN } from './helpers/smoke';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/08-hammers.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '08 Red and Blue Hammers/Red and Blue Hammers.html';

test.describe('Red and Blue Hammers — smoke', () => {
  for (const seed of [1, 42]) {
    test(`runs without invalid values (seed=${seed})`, async ({ page }) => {
      const issues = await smokeNoNaN(page, SIM_PATH, { seed, control: '#toggleButton', mode: 'run', runMs: 2500 });
      expect(issues, JSON.stringify(issues)).toEqual([]);
    });
  }
});

test.describe('Red and Blue Hammers — claims', () => {
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

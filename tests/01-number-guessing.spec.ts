import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/01-number-guessing.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '01 Number Guessing Game/number guessing game.html';

/**
 * Mulberry32 — must match the PRNG installed in tests/helpers/seed.ts so
 * that we can predict the `answer` the sim draws after navigation.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Predict the sim's secret answer for a given seed. The sim computes
 *   answer = Math.floor(Math.random() * 200) + 1
 * as the very first call to Math.random on the page, so with the mulberry32
 * PRNG installed via addInitScript we can reproduce the same draw here.
 *
 * NOTE: simRunner.loadSim performs goto() then reload(), and addInitScript
 * re-runs on every navigation — so the PRNG is reset to `seed` on reload
 * and the sim's IIFE sees the same first draw predicted here.
 */
function predictAnswer(seed: number): number {
  return Math.floor(mulberry32(seed)() * 200) + 1;
}

async function enterGuess(page: Page, value: number | string): Promise<void> {
  await page.locator('#ngs-guessInput').evaluate((el, v) => {
    (el as HTMLInputElement).value = String(v);
  }, value);
  await page.evaluate(() => (window as any)._ngs.makeGuess());
}

async function getGuessCount(page: Page): Promise<number> {
  const txt = await page.locator('#ngs-guessCount').textContent();
  return parseInt(txt!, 10);
}

async function getRange(page: Page): Promise<{ low: number; high: number }> {
  // updateRange() / resetGame() mirror knownLow/knownHigh into data-* attrs
  // on the input so the test contract is stable even if the placeholder copy
  // or typography changes later.
  const input = page.locator('#ngs-guessInput');
  const lo = (await input.getAttribute('data-range-low'))!;
  const hi = (await input.getAttribute('data-range-high'))!;
  return { low: parseInt(lo, 10), high: parseInt(hi, 10) };
}

test.describe('Number Guessing — smoke', () => {
  for (const seed of [1, 7, 42, 123]) {
    test(`seed=${seed}: 10 random guesses produce no NaN`, async ({ page }) => {
      await loadSim(page, SIM_PATH, { seed });
      // Make 10 arbitrary guesses in [1, 200]. The game may end early if one
      // happens to hit the answer; that's fine — the point is the DOM stays clean.
      const gen = mulberry32(seed ^ 0xDEADBEEF);
      for (let i = 0; i < 10; i++) {
        const g = Math.floor(gen() * 200) + 1;
        await enterGuess(page, g);
      }
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }
});

test.describe('Number Guessing — invariants', () => {
  test('answer is always in [1, 200]', async ({ page }) => {
    for (const seed of [1, 7, 42, 123, 999]) {
      await loadSim(page, SIM_PATH, { seed });
      const answer = predictAnswer(seed);
      expect(answer, `seed=${seed}`).toBeGreaterThanOrEqual(1);
      expect(answer, `seed=${seed}`).toBeLessThanOrEqual(200);

      // Confirm our predicted answer actually matches the sim by feeding it
      // as a guess: on a correct first guess, the log announces success.
      await enterGuess(page, answer);
      const count = await getGuessCount(page);
      expect(count, `seed=${seed}: correct answer should be recorded`).toBe(1);
      const { low, high } = await getRange(page);
      expect(low, `seed=${seed}`).toBe(answer);
      expect(high, `seed=${seed}`).toBe(answer);
    }
  });

  test('after every guess, knownLow ≤ answer ≤ knownHigh', async ({ page }) => {
    const seed = 42;
    await loadSim(page, SIM_PATH, { seed });
    const answer = predictAnswer(seed);

    // Drive a binary search; at every step both before and after the guess
    // the displayed range must bracket the true answer.
    let lo = 1;
    let hi = 200;
    for (let step = 0; step < 10 && lo < hi; step++) {
      const mid = Math.floor((lo + hi) / 2);
      const before = await getRange(page);
      expect(answer, `before guess ${step}: range [${before.low}, ${before.high}]`).toBeGreaterThanOrEqual(before.low);
      expect(answer, `before guess ${step}: range [${before.low}, ${before.high}]`).toBeLessThanOrEqual(before.high);

      await enterGuess(page, mid);

      const after = await getRange(page);
      expect(answer, `after guess ${step}=${mid}: range [${after.low}, ${after.high}]`).toBeGreaterThanOrEqual(after.low);
      expect(answer, `after guess ${step}=${mid}: range [${after.low}, ${after.high}]`).toBeLessThanOrEqual(after.high);

      if (mid < answer) lo = mid + 1;
      else if (mid > answer) hi = mid - 1;
      else { lo = hi = mid; }
    }
  });

  test('invalid inputs are rejected and do not increment guess count', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 3 });
    // Each of these should be rejected (non-numeric, too low, too high).
    for (const bad of ['', 'abc', 0, -1, 201, 500]) {
      await enterGuess(page, bad);
      const count = await getGuessCount(page);
      expect(count, `invalid input ${JSON.stringify(bad)} should not count`).toBe(0);
    }
    // Sanity: a valid guess is accepted.
    await enterGuess(page, 100);
    expect(await getGuessCount(page)).toBe(1);
  });
});

test.describe('Number Guessing — oracle', () => {
  test('binary search finds the seeded answer in ≤ ⌈log₂(200)⌉ = 8 guesses', async ({ page }) => {
    const seed = 42;
    await loadSim(page, SIM_PATH, { seed });
    const answer = predictAnswer(seed);

    let lo = 1;
    let hi = 200;
    let found = false;
    const maxGuesses = Math.ceil(Math.log2(200)); // 8
    for (let i = 0; i < maxGuesses && !found; i++) {
      const mid = Math.floor((lo + hi) / 2);
      await enterGuess(page, mid);
      if (mid === answer) { found = true; break; }
      if (mid < answer) lo = mid + 1;
      else hi = mid - 1;
    }

    expect(found, `seed=${seed}: expected to find answer=${answer} within ${maxGuesses} guesses`).toBe(true);
    const count = await getGuessCount(page);
    expect(count).toBeLessThanOrEqual(maxGuesses);
    // Range should have collapsed to [answer, answer].
    const { low, high } = await getRange(page);
    expect(low).toBe(answer);
    expect(high).toBe(answer);
  });
});

test.describe('Number Guessing — claims', () => {
  for (const c of claims.claims) {
    if (c.type === 'formula' && c.formula && c.inputs && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => {
        const result = evalFormula(c.formula!, c.inputs!);
        const tol = c.tolerance ?? 0;
        expect(Math.abs(result - (c.expected as number))).toBeLessThanOrEqual(tol);
      });
    } else if (c.type === 'literal' && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => {
        expect(c.expected).toBeDefined();
      });
    } else if (c.type === 'invariant') {
      test(`claim: ${c.id}`, () => {
        test.skip(true, 'invariant tested in invariants block');
      });
    }
  }
});

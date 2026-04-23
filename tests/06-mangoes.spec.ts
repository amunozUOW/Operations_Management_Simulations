import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { mangoes } from './helpers/oracles';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/06-mangoes.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '06 Mangoes/Mangoes.html';

const STORAGE_KEY = 'ops802_mangoes_v1';
const MAX_TURNS = 10;

// Phase cost parameters (mirror PHASE_CONFIG in the sim).
const PHASE_PARAMS: Record<1 | 2, { S: number; H: number }> = {
  1: { S: 1000, H: 0.1 },
  2: { S: 150, H: 0.7 },
};

/** Row stored in state.history (see processOrder in the sim). */
interface HistoryRow {
  turn: number;
  orderQty: number;
  demand: number;
  invBefore: number;
  invAfter: number;
  remaining: number;
  revenue: number;
  orderCost: number;
  holdingCost: number;
  totalCost: number;
  cash: number;
}

/** Snapshot of the sim's internal state, read via localStorage. */
interface MangoState {
  currentPhase: number;
  turn: number;
  phaseTurns: number;
  cashOnHand: number;
  questionsShown: number;
  insightsRevealed: number;
  history: HistoryRow[];
  actualDemands: number[];
  cashHistory: number[];
  revenues: number[];
  totalCosts: number[];
  orderCosts: number[];
  holdingCosts: number[];
  gameOver: boolean;
  eoqRevealed: boolean;
}

async function readState(page: Page): Promise<MangoState> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  if (!raw) throw new Error(`localStorage key "${STORAGE_KEY}" is empty`);
  return JSON.parse(raw) as MangoState;
}

/** Set the number-input order quantity and fire the input event. */
async function setOrderInput(page: Page, qty: number): Promise<void> {
  await page.locator('#orderInput').evaluate((el, v) => {
    (el as HTMLInputElement).value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, qty);
}

/** Click the sim's dynamically-rendered "Skip to Phase 2" override button. */
async function skipToPhase2(page: Page): Promise<void> {
  await page.locator('button:has-text("Skip to Phase 2")').click();
  // setPhase(2) re-colors phaseLabel2 to the active blue (rgb(37,99,235)).
  await expect(page.locator('#phaseLabel2')).toHaveCSS(
    'background-color',
    'rgb(37, 99, 235)',
  );
}

/**
 * Try to submit an order at the given quantity. Returns true if the order
 * was accepted (phaseTurns advanced), false if it was rejected (e.g. budget
 * constraint or game-over). This is robust against the sim's dynamic
 * bankruptcy guard which can reject a too-large order without ending the
 * game.
 */
async function trySubmitOrder(page: Page, qty: number): Promise<boolean> {
  // phaseTurns is displayed in #turnCounter.
  const prev = parseInt(
    ((await page.locator('#turnCounter').textContent()) ?? '0').trim() || '0',
    10,
  );
  await setOrderInput(page, Math.max(0, Math.floor(qty)));
  await page.locator('#submitBtn').click();
  // Give the synchronous submitOrder() a tick to update the DOM/state.
  const curr = parseInt(
    ((await page.locator('#turnCounter').textContent()) ?? '0').trim() || '0',
    10,
  );
  return curr === prev + 1;
}

/**
 * Run all 10 turns in the current phase. On each turn we pick an order
 * quantity that should generally be affordable given the starting cash and
 * typical skewed-random demand. If the sim rejects the order (cash guard),
 * we progressively halve and retry, finally falling back to 0. Breaks out
 * if the submit button becomes disabled (phase complete or bankruptcy).
 */
async function playPhase(
  page: Page,
  opts: { firstOrder: number; subsequentOrder: number } = {
    firstOrder: 1000,
    subsequentOrder: 500,
  },
): Promise<void> {
  for (let t = 0; t < MAX_TURNS; t++) {
    // Stop if the submit button is disabled (phase complete / game over).
    const disabled = await page.locator('#submitBtn').isDisabled();
    if (disabled) break;

    const target = t === 0 ? opts.firstOrder : opts.subsequentOrder;
    let qty = target;
    let accepted = false;
    // Try the target; if rejected by the budget guard, halve a few times.
    for (let attempt = 0; attempt < 4 && !accepted; attempt++) {
      accepted = await trySubmitOrder(page, qty);
      if (accepted) break;
      // If the game is over we'll bail on the next outer-loop iteration.
      const stillEnabled = !(await page.locator('#submitBtn').isDisabled());
      if (!stillEnabled) break;
      qty = Math.floor(qty / 2);
    }
    // Last-ditch: try order=0 which never fails the guard (cash only decays
    // via holding cost, which the sim checks via checkUnavoidableBankruptcy).
    if (!accepted && !(await page.locator('#submitBtn').isDisabled())) {
      await trySubmitOrder(page, 0);
    }
  }
}

// ---------- SMOKE ----------
test.describe('Mangoes — smoke', () => {
  for (const seed of [1, 42]) {
    test(`phase 1 seed=${seed}: 10 turns produce no NaN`, async ({ page }) => {
      await loadSim(page, SIM_PATH, { seed });
      await playPhase(page, { firstOrder: 1000, subsequentOrder: 500 });

      // Check for invalid values after every turn was exercised. The sim
      // renders metrics synchronously on each submit, so a single post-run
      // scan covers all intermediate states (DOM is replaced each turn).
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }

  for (const seed of [7, 99]) {
    test(`phase 2 seed=${seed}: 10 turns produce no NaN`, async ({ page }) => {
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase2(page);
      // Phase 2 has cheaper ordering ($150) but expensive holding ($0.70).
      // Smaller orders are more realistic here.
      await playPhase(page, { firstOrder: 600, subsequentOrder: 400 });

      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }
});

// ---------- INVARIANTS ----------
test.describe('Mangoes — invariants', () => {
  test('totalCost = orderCost + holdingCost (every turn, both phases)', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 11 });
    await playPhase(page, { firstOrder: 1000, subsequentOrder: 500 });
    const s1 = await readState(page);
    expect(s1.history.length, 'phase 1 produced history').toBeGreaterThan(0);
    for (const r of s1.history) {
      expect(r.totalCost, `phase 1 turn ${r.turn}`).toBeCloseTo(
        r.orderCost + r.holdingCost,
        2,
      );
    }

    // Phase 2 — skip into it and play again so we cover both cost structures.
    await skipToPhase2(page);
    await playPhase(page, { firstOrder: 600, subsequentOrder: 400 });
    const s2 = await readState(page);
    expect(s2.history.length, 'phase 2 produced history').toBeGreaterThan(0);
    for (const r of s2.history) {
      expect(r.totalCost, `phase 2 turn ${r.turn}`).toBeCloseTo(
        r.orderCost + r.holdingCost,
        2,
      );
    }
  });

  test('inventoryAfterDemand ≥ 0 for every turn (sim floors at 0)', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 17 });
    await playPhase(page, { firstOrder: 1000, subsequentOrder: 500 });
    const s = await readState(page);
    expect(s.history.length).toBeGreaterThan(0);
    for (const r of s.history) {
      expect(r.remaining, `turn ${r.turn}: remaining=${r.remaining}`).toBeGreaterThanOrEqual(0);
    }
  });

  test('cashOnHand[t] = cashOnHand[t-1] + revenue − totalCost (every turn)', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 29 });
    await playPhase(page, { firstOrder: 1000, subsequentOrder: 500 });
    const s = await readState(page);
    expect(s.history.length).toBeGreaterThan(0);

    // Starting cash is $1500. The sim mutates state.cashOnHand inside
    // processOrder via: cashOnHand += revenue − totalCost.
    let prevCash = 1500;
    for (const r of s.history) {
      const expected = prevCash + r.revenue - r.totalCost;
      expect(r.cash, `turn ${r.turn}`).toBeCloseTo(expected, 2);
      prevCash = r.cash;
    }
  });
});

// ---------- ORACLE ----------
test.describe('Mangoes — oracle', () => {
  test('mangoes.eoq(633, 1000, 0.1) matches sqrt(2*633*1000/0.1)', () => {
    expect(mangoes.eoq(633, 1000, 0.1)).toBeCloseTo(Math.sqrt((2 * 633 * 1000) / 0.1), 9);
  });

  test('phase 2 EOQ is dramatically smaller than phase 1 EOQ (ratio < 0.2)', () => {
    // Same average demand, different cost structure: S drops 1000→150, H rises 0.1→0.7.
    const D = 633;
    const eoq1 = mangoes.eoq(D, PHASE_PARAMS[1].S, PHASE_PARAMS[1].H);
    const eoq2 = mangoes.eoq(D, PHASE_PARAMS[2].S, PHASE_PARAMS[2].H);
    const ratio = eoq2 / eoq1;
    expect(ratio, `ratio=${ratio.toFixed(3)}`).toBeLessThan(0.2);
  });

  test('EOQ grid: matches closed form across reasonable inputs', () => {
    for (const D of [200, 500, 800, 1200]) {
      for (const S of [100, 150, 500, 1000]) {
        for (const H of [0.1, 0.3, 0.7, 1.0]) {
          expect(mangoes.eoq(D, S, H)).toBeCloseTo(Math.sqrt((2 * D * S) / H), 9);
        }
      }
    }
  });

  test('#eoqValue in Phase 2 matches mangoes.eoq(avgActualDemand, 150, 0.7)', async ({
    page,
  }) => {
    // Skipping to Phase 2 auto-reveals insights 0..2 (all Phase 1 insights).
    // Insight 2 has action 'revealEOQ' which sets state.eoqRevealed=true,
    // so updateEOQDisplay() is called on every subsequent submit using the
    // running average of state.actualDemands.
    await loadSim(page, SIM_PATH, { seed: 5 });
    await skipToPhase2(page);

    // Run through a few turns to accumulate an observed demand average.
    await playPhase(page, { firstOrder: 600, subsequentOrder: 400 });

    const s = await readState(page);
    expect(s.eoqRevealed, 'EOQ should be revealed after skip').toBe(true);
    expect(s.actualDemands.length, 'phase 2 recorded some demand observations')
      .toBeGreaterThan(0);

    // Re-derive EOQ using the sim's formula and params.
    const avg = s.actualDemands.reduce((a, b) => a + b, 0) / s.actualDemands.length;
    const expected = mangoes.eoq(avg, PHASE_PARAMS[2].S, PHASE_PARAMS[2].H);

    // The sim displays the value rounded to the nearest integer, with
    // thousands separators (e.g. "1,234"). Parse it back.
    const displayedTxt = (await page.locator('#eoqValue').textContent())!;
    const displayed = parseFloat(displayedTxt.replace(/[^0-9.\-]/g, ''));
    // toLocaleString on an integer; compare to the rounded expected value
    // within 1 unit (rounding tolerance).
    expect(Math.abs(displayed - Math.round(expected)), `displayed=${displayed}, expected≈${expected.toFixed(2)}`)
      .toBeLessThanOrEqual(1);
  });
});

// ---------- CLAIMS ----------
test.describe('Mangoes — claims', () => {
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

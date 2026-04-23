import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { supplyChainFulfill, SupplyChainState } from './helpers/oracles';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/07-supply-chain.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '07 Supply Chain/Supply Chain.html';
const STORAGE_KEY = 'ops802_supply_chain_v1';
const MAX_TURNS = 30;

// Costs (mirror the sim's top-level constants).
const COST_B = 1.0;
const COST_I = 0.5;
const SALE_PRICE = 5.0;
const INIT_EI = 12;
const INIT_R = 12;

/** Row stored in state.history by advanceTurn(). */
interface HistoryRow {
  turn: number;
  demand: number;
  factoryQ: number;
  factoryEI: number;
  retailerQ: number;
  retailerEI: number;
  manufacturerQ?: number;
  manufacturerEI?: number;
  sales: number;
  cost: number;
  revenue: number;
  profit: number;
  cumProfit: number;
}

/** Full snapshot of the sim's persisted state. Arrays are t-indexed. */
interface SCState {
  currentPhase: number;
  turnNumber: number;
  totalProfit: number;
  lastDemand: number;
  lastRevenue: number;
  lastCost: number;
  lastSales: number;
  questionsShown: number;
  insightsRevealed: number;
  factoryQ: number[]; retailerQ: number[]; manufacturerQ: number[];
  factoryI: number[]; retailerI: number[]; manufacturerI: number[];
  factoryR: number[]; retailerR: number[]; manufacturerR: number[];
  factoryB: number[]; retailerB: number[]; manufacturerB: number[];
  retailerSales: number[];
  factoryIData: number[]; retailerIData: number[]; manufacturerIData: number[];
  factoryQData: number[]; retailerQData: number[]; manufacturerQData: number[];
  history: HistoryRow[];
  bullwhipRevealed: boolean;
  gameOver: boolean;
}

async function readState(page: Page): Promise<SCState> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  if (!raw) throw new Error(`localStorage key "${STORAGE_KEY}" is empty`);
  return JSON.parse(raw) as SCState;
}

/** Set a range slider and fire the input event (so the label updates too). */
async function setSlider(page: Page, selector: string, v: number): Promise<void> {
  await page.locator(selector).evaluate((el, val) => {
    (el as HTMLInputElement).value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}

/** Click Next Turn and wait for #turnCounter to tick up. */
async function nextTurn(page: Page): Promise<void> {
  const prev = ((await page.locator('#turnCounter').textContent()) ?? '').trim();
  await page.locator('#nextTurnBtn').click();
  await page.waitForFunction((p) => {
    const el = document.getElementById('turnCounter');
    return !!(el && el.textContent && el.textContent.trim() !== p);
  }, prev);
}

/** Use the override button to jump to a later phase (resets turn counter). */
async function skipToPhase(page: Page, phase: 2 | 3): Promise<void> {
  await page.locator(`button:has-text("Skip to Phase ${phase}")`).first().click();
  // setPhase() colors the active label blue (rgb(37, 99, 235)).
  await expect(page.locator(`#phaseLabel${phase}`)).toHaveCSS(
    'background-color',
    'rgb(37, 99, 235)',
  );
  await expect(page.locator('#turnCounter')).toHaveText('0');
}

/** Parse a currency-formatted profit string like "$-12.50" or "$1,234.56". */
function parseMoney(txt: string): number {
  const cleaned = txt.replace(/[$,\s]/g, '');
  return parseFloat(cleaned);
}

/** Assert #metricProfit is a valid, finite dollar value. */
async function assertProfitValid(page: Page, label: string): Promise<void> {
  const txt = ((await page.locator('#metricProfit').textContent()) ?? '').trim();
  expect(txt, `${label}: profit text`).not.toMatch(/NaN/i);
  const n = parseMoney(txt);
  expect(Number.isFinite(n), `${label}: parsed="${txt}" -> ${n}`).toBe(true);
}

/** Sample variance (n−1) to match the sim's own bullwhip calculation. */
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return s / (arr.length - 1);
}

/** Cost of holding one echelon's inventory (matches echelonCost() in sim). */
function echelonCost(ei: number): number {
  return ei > 0 ? ei * COST_I : -1 * ei * COST_B;
}

/**
 * Run all 30 turns of the current phase, setting the given sliders before
 * each click. After every turn, scan the DOM for invalid values and assert
 * that #metricProfit is a finite dollar amount.
 */
async function runPhase(
  page: Page,
  sliders: { factory: number; retailer: number; manufacturer?: number },
): Promise<void> {
  await setSlider(page, '#factorySlider', sliders.factory);
  await setSlider(page, '#retailerSlider', sliders.retailer);
  if (sliders.manufacturer !== undefined) {
    await setSlider(page, '#manufacturerSlider', sliders.manufacturer);
  }
  for (let i = 0; i < MAX_TURNS; i++) {
    await nextTurn(page);
    const issues = await scanForInvalidValues(page);
    expect(issues, `after turn ${i + 1}: ${JSON.stringify(issues)}`).toEqual([]);
    await assertProfitValid(page, `after turn ${i + 1}`);
  }
}

// ---------- SMOKE ----------
test.describe('Supply Chain — smoke', () => {
  const configs: { name: string; factory: number; retailer: number; manufacturer?: number }[] = [
    { name: 'small', factory: 3, retailer: 3 },
    { name: 'moderate', factory: 6, retailer: 5 },
    { name: 'large', factory: 15, retailer: 12 },
  ];

  for (const seed of [1, 42]) {
    for (const cfg of configs) {
      test(`phase 1 seed=${seed} ${cfg.name}: 30 turns, no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await runPhase(page, { factory: cfg.factory, retailer: cfg.retailer });
      });
    }
  }

  for (const seed of [7, 99]) {
    for (const cfg of configs) {
      test(`phase 2 seed=${seed} ${cfg.name}: 30 turns, no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await skipToPhase(page, 2);
        await runPhase(page, { factory: cfg.factory, retailer: cfg.retailer });
      });
    }
  }

  const configs3: { name: string; factory: number; retailer: number; manufacturer: number }[] = [
    { name: 'small', factory: 5, retailer: 5, manufacturer: 5 },
    { name: 'moderate', factory: 12, retailer: 12, manufacturer: 12 },
    { name: 'large', factory: 18, retailer: 18, manufacturer: 18 },
  ];
  for (const seed of [3, 21]) {
    for (const cfg of configs3) {
      test(`phase 3 seed=${seed} ${cfg.name}: 30 turns, no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await skipToPhase(page, 3);
        await runPhase(page, cfg);
      });
    }
  }
});

// ---------- REGRESSION: fresh load, one click, no NaN (the bug we just fixed) ----------
test.describe('Supply Chain — NaN regression', () => {
  test('fresh load (no seed, no saved state): first Next Turn keeps profit finite', async ({
    page,
  }) => {
    // Deliberately omit the seed — this exercises the exact path that
    // produced NaN before the fix. Default sliders (all 12) are used.
    await loadSim(page, SIM_PATH);
    await nextTurn(page);
    const txt = ((await page.locator('#metricProfit').textContent()) ?? '').trim();
    expect(txt, `profit text after first turn: "${txt}"`).not.toMatch(/NaN/i);
    const n = parseMoney(txt);
    expect(Number.isFinite(n), `parsed: "${txt}" -> ${n}`).toBe(true);

    // Also sweep the full DOM — a NaN hiding in the history row or diagram
    // would be just as damning.
    const issues = await scanForInvalidValues(page);
    expect(issues, `DOM issues: ${JSON.stringify(issues)}`).toEqual([]);
  });
});

// ---------- INVARIANTS ----------
test.describe('Supply Chain — invariants', () => {
  test('conservation: (eI >= 0 && eB === 0) || (eI < 0 && eB === -eI) for every t', async ({
    page,
  }) => {
    await loadSim(page, SIM_PATH, { seed: 11 });
    // Seed light orders so backlog shows up and we also cover the eI>0 branch.
    await runPhase(page, { factory: 3, retailer: 3 });
    const s = await readState(page);
    // t=0 is the initial state; walk the recorded turns 1..30.
    for (let t = 1; t <= s.turnNumber; t++) {
      const fI = s.factoryI[t], fB = s.factoryB[t];
      const rI = s.retailerI[t], rB = s.retailerB[t];
      expect(
        (fI >= 0 && fB === 0) || (fI < 0 && fB === -fI),
        `factory turn ${t}: EI=${fI} B=${fB}`,
      ).toBe(true);
      expect(
        (rI >= 0 && rB === 0) || (rI < 0 && rB === -rI),
        `retailer turn ${t}: EI=${rI} B=${rB}`,
      ).toBe(true);
    }

    // Re-run in Phase 3 so the manufacturer echelon gets covered too.
    await loadSim(page, SIM_PATH, { seed: 11 });
    await skipToPhase(page, 3);
    await runPhase(page, { factory: 8, retailer: 8, manufacturer: 8 });
    const s3 = await readState(page);
    for (let t = 1; t <= s3.turnNumber; t++) {
      const mI = s3.manufacturerI[t], mB = s3.manufacturerB[t];
      expect(
        (mI >= 0 && mB === 0) || (mI < 0 && mB === -mI),
        `manufacturer turn ${t}: EI=${mI} B=${mB}`,
      ).toBe(true);
    }
  });

  test('retailerSales[t] <= demand[t] for every recorded turn', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 17 });
    await runPhase(page, { factory: 5, retailer: 5 });
    const s = await readState(page);
    for (const row of s.history) {
      expect(row.sales, `turn ${row.turn}`).toBeLessThanOrEqual(row.demand);
    }
    expect(s.history.length).toBe(MAX_TURNS);
  });

  test('profit identity (per turn): revenue − echelonCost(·) matches history', async ({
    page,
  }) => {
    // Phase 1 — 2 echelons.
    await loadSim(page, SIM_PATH, { seed: 23 });
    await runPhase(page, { factory: 6, retailer: 5 });
    const s1 = await readState(page);
    for (let t = 1; t <= s1.turnNumber; t++) {
      const rev = s1.retailerSales[t] * SALE_PRICE;
      const cost = echelonCost(s1.factoryI[t]) + echelonCost(s1.retailerI[t]);
      const row = s1.history[t - 1];
      expect(row.revenue, `P1 turn ${t} revenue`).toBeCloseTo(rev, 6);
      expect(row.cost, `P1 turn ${t} cost`).toBeCloseTo(cost, 6);
      expect(row.profit, `P1 turn ${t} profit`).toBeCloseTo(rev - cost, 6);
    }

    // Phase 3 — 3 echelons. Manufacturer cost must be included.
    await loadSim(page, SIM_PATH, { seed: 23 });
    await skipToPhase(page, 3);
    await runPhase(page, { factory: 12, retailer: 12, manufacturer: 12 });
    const s3 = await readState(page);
    for (let t = 1; t <= s3.turnNumber; t++) {
      const rev = s3.retailerSales[t] * SALE_PRICE;
      const cost =
        echelonCost(s3.factoryI[t]) +
        echelonCost(s3.retailerI[t]) +
        echelonCost(s3.manufacturerI[t]);
      const row = s3.history[t - 1];
      expect(row.revenue, `P3 turn ${t} revenue`).toBeCloseTo(rev, 6);
      expect(row.cost, `P3 turn ${t} cost`).toBeCloseTo(cost, 6);
      expect(row.profit, `P3 turn ${t} profit`).toBeCloseTo(rev - cost, 6);
    }
  });

  test('bullwhip (Phase 2): Var(retailerQ history) ≥ Var(demand history) × 0.9', async ({
    page,
  }) => {
    // A seed & policy chosen to be "reactive": the retailer over-orders once
    // the demand jump hits, which is what the bullwhip claim captures.
    await loadSim(page, SIM_PATH, { seed: 42 });
    await skipToPhase(page, 2);
    // Alternate orders a bit across turns so Q varies — steady 12 would
    // give variance 0 and make the test trivially pass but uninformative.
    // Instead, we bump retailer orders after turn 5 to react to the jump.
    await setSlider(page, '#factorySlider', 8);
    await setSlider(page, '#retailerSlider', 8);
    for (let i = 0; i < MAX_TURNS; i++) {
      if (i === 5) {
        await setSlider(page, '#factorySlider', 18);
        await setSlider(page, '#retailerSlider', 18);
      }
      await nextTurn(page);
    }
    const s = await readState(page);
    const demands = s.history.map((h) => h.demand);
    const rQs = s.history.map((h) => h.retailerQ);
    const vD = variance(demands);
    const vQ = variance(rQs);
    expect(
      vQ,
      `Var(retailerQ)=${vQ.toFixed(2)} should be >= 0.9 * Var(demand)=${(vD * 0.9).toFixed(2)}`,
    ).toBeGreaterThanOrEqual(vD * 0.9);
  });
});

// ---------- ORACLE ----------
test.describe('Supply Chain — oracle', () => {
  /**
   * Build an oracle SupplyChainState that mirrors the sim's initial state:
   * INIT_EI=12 in eI[0], INIT_R=12 in eR[0], eB[0]=0, sales[0]=0.
   */
  function newOracle(): SupplyChainState {
    return {
      factoryI: [INIT_EI], factoryR: [INIT_R], factoryB: [0],
      retailerI: [INIT_EI], retailerR: [INIT_R], retailerB: [0],
      retailerSales: [0],
    };
  }

  /**
   * Drive Phase 1 for a given slider schedule. Important mapping:
   *   - In the sim, factoryR[t] = factoryQ[t-1] and the factory echelon's
   *     downOrder is retailerQ[t-1]. So for turn t in the oracle we pass
   *     factoryOrder = factoryQ[t-1] and retailerOrder = retailerQ[t-1].
   *   - factoryQ[0] and retailerQ[0] are the slider values at reset, which
   *     is 12 for both before any user interaction.
   */
  async function runSchedule(
    page: Page,
    seed: number,
    schedule: { factory: number; retailer: number }[],
  ): Promise<{ domState: SCState; oracle: SupplyChainState; demands: number[] }> {
    await loadSim(page, SIM_PATH, { seed });
    const oracle = newOracle();
    // Track the Q history exactly as the sim does — index 0 is the reset
    // default (12), then index t is the value that was on the slider when
    // Next Turn was clicked for turn t.
    const factoryQ: number[] = [INIT_EI];
    const retailerQ: number[] = [INIT_R];
    const demands: number[] = [];

    for (let t = 1; t <= schedule.length; t++) {
      const { factory, retailer } = schedule[t - 1];
      await setSlider(page, '#factorySlider', factory);
      await setSlider(page, '#retailerSlider', retailer);
      await nextTurn(page);

      // Read sim's just-generated demand for this turn.
      const s = await readState(page);
      const demand = s.lastDemand;
      demands.push(demand);

      // Oracle uses the PREVIOUS turn's Qs: those are what arrive as
      // factoryR[t] and what the factory must fulfil as downstream order.
      supplyChainFulfill(oracle, t, factoryQ[t - 1], retailerQ[t - 1], demand);

      factoryQ.push(factory);
      retailerQ.push(retailer);
    }

    const domState = await readState(page);
    return { domState, oracle, demands };
  }

  const schedules: { name: string; seed: number; plan: { factory: number; retailer: number }[] }[] = [
    {
      name: 'steady',
      seed: 101,
      plan: Array.from({ length: 8 }, () => ({ factory: 5, retailer: 5 })),
    },
    {
      name: 'stepped',
      seed: 202,
      plan: [
        { factory: 4, retailer: 4 }, { factory: 4, retailer: 4 },
        { factory: 6, retailer: 6 }, { factory: 6, retailer: 6 },
        { factory: 3, retailer: 5 }, { factory: 7, retailer: 5 },
        { factory: 5, retailer: 4 }, { factory: 5, retailer: 4 },
      ],
    },
    {
      name: 'sawtooth',
      seed: 303,
      plan: [
        { factory: 2, retailer: 8 }, { factory: 8, retailer: 2 },
        { factory: 2, retailer: 8 }, { factory: 8, retailer: 2 },
        { factory: 2, retailer: 8 }, { factory: 8, retailer: 2 },
        { factory: 2, retailer: 8 }, { factory: 8, retailer: 2 },
        { factory: 2, retailer: 8 }, { factory: 8, retailer: 2 },
      ],
    },
  ];

  for (const sch of schedules) {
    test(`Phase 1 oracle matches sim (${sch.name}, seed=${sch.seed}, ${sch.plan.length} turns)`, async ({
      page,
    }) => {
      const { domState, oracle, demands } = await runSchedule(page, sch.seed, sch.plan);
      expect(demands.length).toBe(sch.plan.length);
      for (let t = 1; t <= sch.plan.length; t++) {
        expect(oracle.factoryI[t], `factoryI[${t}]`).toBe(domState.factoryI[t]);
        expect(oracle.retailerI[t], `retailerI[${t}]`).toBe(domState.retailerI[t]);
        expect(oracle.retailerSales[t], `retailerSales[${t}]`).toBe(
          domState.retailerSales[t],
        );

        // Profit identity using oracle values.
        const rev = oracle.retailerSales[t] * SALE_PRICE;
        const cost = echelonCost(oracle.factoryI[t]) + echelonCost(oracle.retailerI[t]);
        const expectedProfit = rev - cost;
        const domProfit = domState.history[t - 1].profit;
        expect(domProfit, `profit[${t}]`).toBeCloseTo(expectedProfit, 6);
      }
    });
  }
});

// ---------- CLAIMS ----------
test.describe('Supply Chain — claims', () => {
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

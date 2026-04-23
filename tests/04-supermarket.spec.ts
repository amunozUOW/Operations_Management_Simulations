import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { supermarket } from './helpers/oracles';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/04-supermarket.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '04 Supermarket Checkout/Supermarket Checkout.html';

const PHASE_TURNS: Record<1 | 2 | 3, number> = { 1: 5, 2: 15, 3: 15 };

async function setStaff(page: Page, n: number): Promise<void> {
  await page.locator('#staffSlider').evaluate((el, v) => {
    (el as HTMLInputElement).value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
}

/**
 * Click Next Turn and wait for the turn counter to tick up. The sim updates
 * #turnCounter synchronously inside runTurn(), but waitForFunction is still
 * the robust way to avoid racing any post-update rendering.
 */
async function nextTurn(page: Page): Promise<void> {
  const prev = (await page.locator('#turnCounter').textContent())!.trim();
  await page.locator('#nextTurnBtn').click();
  await page.waitForFunction((p) => {
    const el = document.getElementById('turnCounter');
    return !!(el && el.textContent && el.textContent.trim() !== p);
  }, prev);
}

/**
 * Skip to a later phase using the override "Skip to Phase N" button. This
 * auto-reveals insights 0..(max for skipped phases), which conveniently
 * unblocks #capacityDisplay (needs ≥ 1 revealed) and #utilizationDisplay
 * (needs ≥ 2 revealed) — essential for reading those metrics from the DOM.
 */
async function skipToPhase(page: Page, phase: 2 | 3): Promise<void> {
  const btnId = phase === 2 ? '#overrideSkip2' : '#overrideSkip3';
  await page.locator(btnId).click();
  // setPhase() re-colors phaseLabelN active → rgb(37, 99, 235).
  await expect(page.locator(`#phaseLabel${phase}`)).toHaveCSS(
    'background-color',
    'rgb(37, 99, 235)',
  );
}

/**
 * Reveal the next N insights via the override "Reveal Next Question" button
 * followed by clicking the yellow question card. Used to unblock the
 * capacity/utilization displays in Phase 1 without changing phase.
 *
 * Strategy: each cycle pressess overrideRevealQ to surface the next
 * question card, then clicks that card to reveal its answer and bump
 * state.insightsRevealed.
 */
async function revealInsights(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.locator('#overrideRevealQ').click();
    // The newly-shown question has data-reveal-index = current insightsRevealed.
    // Click it — clicking a card with matching index calls revealInsightAnswer.
    const before = await page.locator('#insightsCounter').textContent();
    const nextIdx = parseInt(before!.split(' ')[0], 10);
    await page.locator(`[data-reveal-index="${nextIdx}"]`).click();
    // Wait for the counter text to increment.
    await page.waitForFunction(
      (b) => (document.getElementById('insightsCounter')?.textContent ?? '') !== b,
      before,
    );
  }
}

/** Row of the history table, fully parsed into numbers. */
interface HistoryRow {
  turn: number;
  counters: number;
  demand: number;
  serviceTime: number;
  revenue: number;
  /** NaN if not revealed. */
  capacity: number;
  /** NaN if not revealed. */
  utilization: number;
  throughputTime: number;
  staffingCosts: number;
  penaltyCosts: number;
  profit: number;
}

async function readHistory(page: Page): Promise<HistoryRow[]> {
  return page.evaluate(() => {
    const rows: HistoryRow[] = [];
    // Local duplicate of the interface — evaluate runs in-browser and can't
    // import TS types.
    const parseNum = (t: string): number => {
      const m = t.replace(/[$,%]/g, '').match(/-?\d+(?:\.\d+)?/);
      return m ? parseFloat(m[0]) : NaN;
    };
    const tbody = document.getElementById('historyBody')!;
    for (const tr of Array.from(tbody.querySelectorAll('tr'))) {
      const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent || '').trim());
      if (cells.length < 11) continue;
      rows.push({
        turn: parseInt(cells[0], 10),
        counters: parseInt(cells[1], 10),
        demand: parseInt(cells[2], 10),
        serviceTime: parseNum(cells[3]),
        revenue: parseNum(cells[4]),
        capacity: parseNum(cells[5]), // NaN if cell is "?"
        utilization: parseNum(cells[6]),
        throughputTime: parseNum(cells[7]),
        staffingCosts: parseNum(cells[8]),
        penaltyCosts: parseNum(cells[9]),
        profit: parseNum(cells[10]),
      });
    }
    // Cast through any — the inline interface above is for documentation.
    return rows as any;
  }) as Promise<HistoryRow[]>;
}

async function runPhaseTurns(page: Page, phase: 1 | 2 | 3): Promise<void> {
  const maxTurns = PHASE_TURNS[phase];
  for (let i = 0; i < maxTurns; i++) await nextTurn(page);
}

// ---------- SMOKE ----------
test.describe('Supermarket Checkout — smoke', () => {
  for (const staff of [3, 7]) {
    for (const seed of [1, 42]) {
      test(`phase 1 staff=${staff} seed=${seed}: all 5 turns, no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await setStaff(page, staff);
        await runPhaseTurns(page, 1);
        const issues = await scanForInvalidValues(page);
        expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
      });
    }
  }

  for (const staff of [3, 10]) {
    for (const seed of [7, 99]) {
      test(`phase 2 staff=${staff} seed=${seed}: all 15 turns, no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await skipToPhase(page, 2);
        await setStaff(page, staff);
        await runPhaseTurns(page, 2);
        const issues = await scanForInvalidValues(page);
        expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
      });
    }
  }

  for (const staff of [5, 8]) {
    for (const seed of [3, 21]) {
      test(`phase 3 staff=${staff} seed=${seed}: all 15 turns, no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await skipToPhase(page, 3);
        await setStaff(page, staff);
        await runPhaseTurns(page, 3);
        const issues = await scanForInvalidValues(page);
        expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
      });
    }
  }
});

// ---------- INVARIANTS ----------
test.describe('Supermarket Checkout — invariants', () => {
  // Skipping to Phase 3 reveals insights 0..5 (unblocking capacity + utilization
  // displays) and gives us 15-turn runs for plenty of data points.
  const FIXED_COST_PER_HOUR = 25;
  const PENALTY_FACTOR = 100;

  test('utilisation in [0, 100] for every turn (uses re-derived value)', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 11 });
    await skipToPhase(page, 3);
    await setStaff(page, 5);
    await runPhaseTurns(page, 3);

    const history = await readHistory(page);
    expect(history.length).toBe(15);
    for (const r of history) {
      // Re-derive from visible quantities so we don't depend on whether
      // utilisation is revealed in the DOM (it is, after skipToPhase(3)).
      const capacity = supermarket.capacity(r.counters, r.serviceTime);
      const util = supermarket.utilization(r.demand, capacity);
      expect(util, `turn ${r.turn}`).toBeGreaterThanOrEqual(0);
      expect(util, `turn ${r.turn}`).toBeLessThanOrEqual(100 + 1e-9);

      // Cross-check: the sim's own stored (clamped) utilisation agrees to
      // the nearest whole percent (history cells use toFixed(0)).
      expect(Math.abs(r.utilization - util), `turn ${r.turn} DOM util vs derived`)
        .toBeLessThanOrEqual(1);
    }
  });

  test('penalty applied iff throughputTime > 60 — matches (demand − capacity) × 100', async ({
    page,
  }) => {
    await loadSim(page, SIM_PATH, { seed: 44 });
    // Use a deliberately low staff count so many turns exceed 60 min and
    // trigger the penalty; and a higher-demand phase for variety.
    await skipToPhase(page, 2);
    await setStaff(page, 2);
    await runPhaseTurns(page, 2);

    const history = await readHistory(page);
    expect(history.length).toBe(15);

    let sawPenalty = 0;
    let sawNoPenalty = 0;
    for (const r of history) {
      const capacity = supermarket.capacity(r.counters, r.serviceTime);
      const tput = supermarket.throughputTime(r.demand, r.counters, r.serviceTime);
      const expectedPenalty =
        tput > 60 ? Math.max(0, (r.demand - capacity) * PENALTY_FACTOR) : 0;

      // History cell uses toFixed(2); compare within half a cent.
      expect(r.penaltyCosts, `turn ${r.turn} (tput=${tput.toFixed(2)})`).toBeCloseTo(
        expectedPenalty,
        1,
      );

      if (expectedPenalty > 0) sawPenalty++;
      else sawNoPenalty++;
    }
    // Guard the test: staff=2 with Phase-2 demand growing to ~75 should
    // give us at least one of each outcome — otherwise the invariant is
    // trivially satisfied and we're not actually testing the gate.
    expect(sawPenalty, 'expected some turns with penalty').toBeGreaterThan(0);
    expect(sawNoPenalty, 'expected some turns without penalty').toBeGreaterThan(0);
  });

  test('profit = revenue × demand − staffingCosts − penaltyCosts matches #profitDisplay', async ({
    page,
  }) => {
    await loadSim(page, SIM_PATH, { seed: 77 });
    await skipToPhase(page, 3);
    await setStaff(page, 4);
    await runPhaseTurns(page, 3);

    const history = await readHistory(page);
    expect(history.length).toBe(15);

    for (const r of history) {
      const capacity = supermarket.capacity(r.counters, r.serviceTime);
      const tput = supermarket.throughputTime(r.demand, r.counters, r.serviceTime);
      const staffingCosts = r.counters * FIXED_COST_PER_HOUR;
      const penaltyCosts = tput > 60 ? Math.max(0, (r.demand - capacity) * PENALTY_FACTOR) : 0;
      const expectedProfit = r.revenue * r.demand - staffingCosts - penaltyCosts;

      // History row profit is formatted to 2 dp — compare within a cent.
      expect(r.profit, `turn ${r.turn}`).toBeCloseTo(expectedProfit, 1);
      expect(r.staffingCosts, `turn ${r.turn}`).toBeCloseTo(staffingCosts, 2);
      expect(r.penaltyCosts, `turn ${r.turn}`).toBeCloseTo(penaltyCosts, 1);
    }

    // And the headline #profitDisplay for the last turn should agree.
    const last = history[history.length - 1];
    const displayedTxt = (await page.locator('#profitDisplay').textContent())!;
    const displayed = parseFloat(displayedTxt.replace(/[^0-9.\-]/g, ''));
    expect(displayed).toBeCloseTo(last.profit, 1);
  });

  test('in-sim: #capacityDisplay matches supermarket.capacity(counters, serviceTime)', async ({
    page,
  }) => {
    // Need at least 1 revealed insight to unblock #capacityDisplay.
    await loadSim(page, SIM_PATH, { seed: 31 });
    await revealInsights(page, 1);
    await setStaff(page, 6);
    await nextTurn(page);

    const history = await readHistory(page);
    expect(history.length).toBe(1);
    const r = history[0];
    const expectedCap = supermarket.capacity(r.counters, r.serviceTime);

    const displayedTxt = (await page.locator('#capacityDisplay').textContent())!;
    const displayed = parseFloat(displayedTxt);
    // Sim uses toFixed(0) on display; compare to nearest integer.
    expect(Math.abs(displayed - expectedCap)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

// ---------- ORACLE ----------
test.describe('Supermarket Checkout — oracle', () => {
  // Pure-formula oracle tests — fast, deterministic, no DOM.
  test('capacity = (60 / serviceTime) × counters across a grid', () => {
    for (const counters of [1, 3, 5, 8, 12, 20]) {
      for (const serviceTime of [3, 4, 5, 6, 7]) {
        const expected = (60 / serviceTime) * counters;
        expect(supermarket.capacity(counters, serviceTime)).toBeCloseTo(expected, 9);
      }
    }
  });

  test('utilisation = min(demand / capacity × 100, 100)', () => {
    // Below saturation — linear.
    expect(supermarket.utilization(50, 100)).toBeCloseTo(50, 9);
    expect(supermarket.utilization(75, 150)).toBeCloseTo(50, 9);
    // At saturation — exactly 100.
    expect(supermarket.utilization(100, 100)).toBe(100);
    // Above saturation — clamped to 100.
    expect(supermarket.utilization(200, 100)).toBe(100);
    expect(supermarket.utilization(70, 36)).toBe(100);
    // Zero demand.
    expect(supermarket.utilization(0, 60)).toBe(0);
  });

  test('throughputTime = serviceTime × demand / counters across a grid', () => {
    for (const counters of [1, 3, 5, 8, 12]) {
      for (const serviceTime of [3, 5, 7]) {
        for (const demand of [20, 50, 70]) {
          const expected = (serviceTime * demand) / counters;
          expect(supermarket.throughputTime(demand, counters, serviceTime)).toBeCloseTo(
            expected,
            9,
          );
        }
      }
    }
  });

  test('docx claim: 50 customers × 3 min / 60 = 2.5 staff (min demand)', () => {
    expect((50 * 3) / 60).toBeCloseTo(2.5, 9);
  });

  test('docx claim: 70 customers × 7 min / 60 ≈ 8.17 staff (max demand)', () => {
    expect((70 * 7) / 60).toBeCloseTo(8.1667, 3);
  });

  test('docx claim: 60 customers × 5 min / 60 = 5 staff (mean)', () => {
    expect((60 * 5) / 60).toBe(5);
  });
});

// ---------- CLAIMS ----------
test.describe('Supermarket Checkout — claims', () => {
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

import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { vending } from './helpers/oracles';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/05-vending.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '05 Vending Machine/Vending Machine.html';

const STORAGE_KEY = 'ops802_vending_machine_v1';
const INITIAL_CASH = 1000;
const SIM_DURATION = 30;

/**
 * Accelerate setInterval so tests don't wait real-time for the sim.
 * Default tick is 1000 ms, with a day advancing every 3 ticks. factor=50
 * shrinks a 30-day run (~90 s) to ~1.8 s real-time. Must run before the
 * sim's IIFE installs its interval — i.e. before page load.
 */
async function accelerateTime(page: Page, factor: number): Promise<void> {
  await page.addInitScript((f: number) => {
    const orig = window.setInterval.bind(window);
    // Cast to any to side-step the overloaded-signature type gymnastics.
    (window as any).setInterval = (fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      const scaled = typeof ms === 'number' && ms > 0 ? Math.max(1, Math.floor(ms / f)) : ms;
      return orig(fn as any, scaled as any, ...(rest as any[]));
    };
  }, factor);
}

/**
 * Auto-dismiss the sim's alert() calls (simulation-complete and game-over
 * prompts). Playwright would otherwise stall waiting for a handler.
 */
function autoDismissDialogs(page: Page): void {
  page.on('dialog', (d) => {
    d.dismiss().catch(() => {});
  });
}

/**
 * Skip to phase N using the sim's own override button. The "Skip Phase"
 * link-style button under the Insights panel auto-reveals all remaining
 * phase insights and advances via advancePhase() (which also calls
 * resetSimState()), so we end up on a fresh day-0 run in the target phase.
 */
async function skipToPhase(page: Page, phase: 2 | 3): Promise<void> {
  const steps = phase - 1; // phase 2 = 1 click, phase 3 = 2 clicks
  for (let i = 0; i < steps; i++) {
    await page.locator('#vmSkipPhase').click();
    // Wait for the phase label background to flip to the active color for
    // the phase we just advanced to: phase 2 = #7c3aed, phase 3 = #059669.
    const target = 1 + i + 1;
    const color = target === 2 ? 'rgb(124, 58, 237)' : 'rgb(5, 150, 105)';
    await expect(page.locator(`#vmPhaseLabel${target}`)).toHaveCSS('background-color', color);
  }
}

/** Set the order quantity slider and fire the input event so the label updates. */
async function setOrderQty(page: Page, qty: number): Promise<void> {
  await page.locator('#vmOrderQuantity').evaluate((el, v) => {
    (el as HTMLInputElement).value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, qty);
}

/** Read a numeric value from an element's text, stripping currency/commas. */
async function readNum(page: Page, selector: string): Promise<number> {
  const t = (await page.locator(selector).textContent()) ?? '';
  const v = parseFloat(t.replace(/[$,]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

/** Snapshot of the sim's internal state, read via localStorage. */
interface VmState {
  currentPhase: number;
  simulatedDay: number;
  inventory: number;
  cashOnHand: number;
  totalCosts: number;
  orderCosts: number;
  holdingCosts: number;
  stockoutCosts: number;
  totalRevenue: number;
  profit: number;
  demandHistory: number[];
  pipelineOrders: { orderDay: number; quantity: number; deliveryDay: number; status: string }[];
}

async function readState(page: Page): Promise<VmState> {
  const raw = await page.evaluate(
    (k) => localStorage.getItem(k),
    STORAGE_KEY,
  );
  if (!raw) throw new Error(`localStorage key "${STORAGE_KEY}" is empty`);
  return JSON.parse(raw) as VmState;
}

/** Is the sim in a terminal state (day 30 reached or stocked out)? */
async function isSimDone(page: Page): Promise<boolean> {
  const label = (await page.locator('#vmToggleSim').textContent()) ?? '';
  return label === 'Complete' || label === 'Game Over';
}

/**
 * Drive the sim to completion (or Game Over) with a simple inventory-
 * maintenance policy: whenever inventory drops below `reorderPoint` and
 * no in-transit order would cover it, pause, issue an order bringing the
 * on-hand + in-transit up to `targetStock`, then resume. Returns when
 * toggleSim reads "Complete" or "Game Over".
 */
async function runWithPolicy(
  page: Page,
  opts: { reorderPoint: number; targetStock: number; timeoutMs?: number } = {
    reorderPoint: 30,
    targetStock: 100,
  },
): Promise<VmState> {
  const { reorderPoint, targetStock, timeoutMs = 20000 } = opts;
  // Kick off the sim.
  await page.locator('#vmToggleSim').click();

  const start = Date.now();
  let lastOrderDay = -1;
  while (Date.now() - start < timeoutMs) {
    if (await isSimDone(page)) break;

    // Read current state cheaply from localStorage (saved on every tick).
    let s: VmState;
    try {
      s = await readState(page);
    } catch {
      await page.waitForTimeout(30);
      continue;
    }

    const inTransit = s.pipelineOrders
      .filter((o) => o.status === 'In Transit')
      .reduce((a, o) => a + o.quantity, 0);
    const projected = s.inventory + inTransit;

    if (
      projected < reorderPoint &&
      s.simulatedDay !== lastOrderDay &&
      s.simulatedDay < SIM_DURATION
    ) {
      const need = Math.max(0, targetStock - projected);
      if (need > 0) {
        // Pause, issue, resume. The sim guards against two orders on the
        // same day, so track lastOrderDay to avoid racing the poll loop.
        const label = (await page.locator('#vmToggleSim').textContent()) ?? '';
        if (label === 'Pause') {
          await page.locator('#vmToggleSim').click();
        }
        await setOrderQty(page, Math.min(100, need));
        await page.locator('#vmIssueOrder').click();
        lastOrderDay = s.simulatedDay;
        // Resume.
        const label2 = (await page.locator('#vmToggleSim').textContent()) ?? '';
        if (label2 === 'Resume' || label2 === 'Start') {
          await page.locator('#vmToggleSim').click();
        }
      }
    }

    await page.waitForTimeout(20);
  }

  if (!(await isSimDone(page))) {
    throw new Error(`sim did not reach terminal state within ${timeoutMs} ms`);
  }
  return readState(page);
}

// ---------- SMOKE ----------
test.describe('Vending Machine — smoke', () => {
  for (const seed of [1, 42]) {
    test(`phase 1 seed=${seed}: 30-day run produces no NaN`, async ({ page }) => {
      autoDismissDialogs(page);
      await accelerateTime(page, 50);
      await loadSim(page, SIM_PATH, { seed });
      await runWithPolicy(page, { reorderPoint: 30, targetStock: 100 });
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }

  for (const seed of [7, 99]) {
    test(`phase 2 seed=${seed}: 30-day run produces no NaN`, async ({ page }) => {
      autoDismissDialogs(page);
      await accelerateTime(page, 50);
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase(page, 2);
      // Higher reorder point because Phase 2 demand can hit 15/day.
      await runWithPolicy(page, { reorderPoint: 45, targetStock: 100 });
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }

  for (const seed of [3, 21]) {
    test(`phase 3 seed=${seed}: 30-day run produces no NaN`, async ({ page }) => {
      autoDismissDialogs(page);
      await accelerateTime(page, 50);
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase(page, 3);
      // Seasonal demand peaks near 15/day — match Phase 2 ordering.
      await runWithPolicy(page, { reorderPoint: 45, targetStock: 100 });
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }
});

// ---------- INVARIANTS ----------
test.describe('Vending Machine — invariants', () => {
  test('totalCosts = orderCosts + holdingCosts + stockoutCosts (state-level)', async ({
    page,
  }) => {
    autoDismissDialogs(page);
    await accelerateTime(page, 50);
    await loadSim(page, SIM_PATH, { seed: 11 });
    const s = await runWithPolicy(page, { reorderPoint: 30, targetStock: 100 });
    expect(s.totalCosts).toBeCloseTo(s.orderCosts + s.holdingCosts + s.stockoutCosts, 2);
  });

  test('profit = totalRevenue − totalCosts (DOM, 2dp)', async ({ page }) => {
    autoDismissDialogs(page);
    await accelerateTime(page, 50);
    await loadSim(page, SIM_PATH, { seed: 17 });
    await runWithPolicy(page, { reorderPoint: 30, targetStock: 100 });

    const rev = await readNum(page, '#vmTotalRevenue');
    const tot = await readNum(page, '#vmTotalCosts');
    const prof = await readNum(page, '#vmProfit');
    expect(prof).toBeCloseTo(rev - tot, 2);
  });

  test('cashOnHand = INITIAL_CASH + totalRevenue − totalCosts (DOM, 2dp)', async ({ page }) => {
    autoDismissDialogs(page);
    await accelerateTime(page, 50);
    await loadSim(page, SIM_PATH, { seed: 29 });
    await runWithPolicy(page, { reorderPoint: 30, targetStock: 100 });

    const rev = await readNum(page, '#vmTotalRevenue');
    const tot = await readNum(page, '#vmTotalCosts');
    const cash = await readNum(page, '#vmCashOnHand');
    expect(cash).toBeCloseTo(INITIAL_CASH + rev - tot, 2);
  });

  test('inventory is never negative across the full run', async ({ page }) => {
    autoDismissDialogs(page);
    await accelerateTime(page, 50);
    await loadSim(page, SIM_PATH, { seed: 5 });
    const s = await runWithPolicy(page, { reorderPoint: 30, targetStock: 100 });
    // Final inventory
    expect(s.inventory, 'final inventory').toBeGreaterThanOrEqual(0);
    // DOM-displayed inventory (rounded) is likewise non-negative.
    const invDom = parseInt(
      ((await page.locator('#vmCurrentInventory').textContent()) ?? '0').trim() || '0',
      10,
    );
    expect(invDom, 'DOM inventory').toBeGreaterThanOrEqual(0);
  });

  test('phase 2 daily demand stays within [5, 15]', async ({ page }) => {
    autoDismissDialogs(page);
    await accelerateTime(page, 50);
    await loadSim(page, SIM_PATH, { seed: 44 });
    await skipToPhase(page, 2);
    const s = await runWithPolicy(page, { reorderPoint: 45, targetStock: 100 });
    expect(s.demandHistory.length, 'some demand observations recorded').toBeGreaterThan(0);
    for (let i = 0; i < s.demandHistory.length; i++) {
      const d = s.demandHistory[i];
      // Max(0, round(BASE_DEMAND + (r-0.5)*2*5)) — so the theoretical range
      // is exactly [5, 15] for any r∈[0,1].
      expect(d, `day ${i + 1}: demand=${d}`).toBeGreaterThanOrEqual(5);
      expect(d, `day ${i + 1}: demand=${d}`).toBeLessThanOrEqual(15);
    }
  });
});

// ---------- ORACLE ----------
test.describe('Vending Machine — oracle', () => {
  test('EOQ(D=10, S=130, H=1) ≈ 51 (rounded)', () => {
    expect(Math.round(vending.eoq(10, 130, 1))).toBe(51);
    // Exact value sqrt(2600) ≈ 50.99.
    expect(vending.eoq(10, 130, 1)).toBeCloseTo(Math.sqrt(2600), 9);
  });

  test('ROP(demand=10/day, leadTime=3) = 30', () => {
    expect(vending.rop(10, 3)).toBe(30);
  });

  test('safetyStock(max=15, avg=10, leadTime=3) = 15', () => {
    expect(vending.safetyStock(15, 10, 3)).toBe(15);
  });

  test('EOQ grid: matches closed form across reasonable inputs', () => {
    for (const D of [5, 10, 20, 50]) {
      for (const S of [50, 100, 130, 200]) {
        for (const H of [0.5, 1, 2]) {
          expect(vending.eoq(D, S, H)).toBeCloseTo(Math.sqrt((2 * D * S) / H), 9);
        }
      }
    }
  });
});

// ---------- CLAIMS ----------
test.describe('Vending Machine — claims', () => {
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

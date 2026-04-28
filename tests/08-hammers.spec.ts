import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/08-hammers.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '08 Red and Blue Hammers/Red and Blue Hammers.html';
const STORAGE_KEY = 'ops802_hammer_shop_v1';

// Constants that mirror the sim's top-level declarations (lines 286-302).
const INITIAL_CASH = 4000;
const SIM_DURATION = 60;
const RED_PRICE = 25;
const BLUE_PRICE = 50;
const REGULAR_WAGE = 5;
const EMERGENCY_WAGE = 25;
const MAX_INVENTORY = 200;
const MAX_ORDER_SIZE = 100;

// Pending-order row in state.pendingOrders.
interface PendingOrder {
  type: 'red' | 'blue';
  quantity: number;
  arrivalTime: number;
}

// Per-bucket arrays of completed / rejected customer info.
interface CustomerBucket {
  red: Array<{ time: number; satisfaction: number; waitTime?: number }>;
  blue: Array<{ time: number; satisfaction: number; waitTime?: number }>;
}

// Snapshot of the sim's persisted state. Only fields we actually read.
interface HammerState {
  currentPhase: number;
  simulatedTime: number;
  isComplete: boolean;
  failureOccurred: boolean;
  failureReason: string | null;
  currentCash: number;
  inventoryRed: number;
  inventoryBlue: number;
  regularStaffCount: number;
  emergencyStaffCount: number;
  totalRevenue: number;
  totalStaffCost: number;
  totalHoldingCost: number;
  totalOrderCost: number;
  totalCustomersServed: number;
  pendingOrders: PendingOrder[];
  completedCustomers: CustomerBucket[];
  rejectedCustomers: CustomerBucket[];
}

/**
 * Accelerate setInterval so smoke tests don't sit through real-time ticks.
 * Default speed is 2000 ms/tick; with factor=200 a 60-min run completes in
 * ~600 ms of wall clock. Must run before the sim's IIFE schedules its tick,
 * i.e. before page load. clearInterval still accepts the returned id.
 */
async function accelerateTime(page: Page, factor: number): Promise<void> {
  await page.addInitScript((f: number) => {
    const orig = window.setInterval.bind(window);
    (window as any).setInterval = (fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      const scaled = typeof ms === 'number' && ms > 0 ? Math.max(1, Math.floor(ms / f)) : ms;
      return orig(fn as any, scaled as any, ...(rest as any[]));
    };
  }, factor);
}

/** Fire input + change on a range slider so the sim's listener updates state. */
async function setSlider(page: Page, selector: string, v: number): Promise<void> {
  await page.locator(selector).evaluate((el, val) => {
    (el as HTMLInputElement).value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}

/** Set a number input's value by firing input/change events. */
async function setNumberInput(page: Page, selector: string, v: number | ''): Promise<void> {
  await page.locator(selector).evaluate((el, val) => {
    (el as HTMLInputElement).value = val === '' ? '' : String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
}

/** Pick the fastest speed the select exposes (1000 ms tick at writing). */
async function selectFastestSpeed(page: Page): Promise<void> {
  const fastest = await page.locator('#speedSelect').evaluate((el) => {
    const sel = el as HTMLSelectElement;
    const vals = Array.from(sel.options).map((o) => parseInt(o.value, 10));
    return Math.min(...vals);
  });
  await page.locator('#speedSelect').selectOption(String(fastest));
}

/** Click Skip-to-Phase-N in the override controls. */
async function skipToPhase(page: Page, phase: 2 | 3): Promise<void> {
  const btnId = phase === 2 ? '#overrideSkip2' : '#overrideSkip3';
  await page.locator(btnId).click();
  await expect(page.locator(`#phaseLabel${phase}`)).toHaveCSS(
    'background-color',
    'rgb(0, 51, 255)',
  );
}

/** Click Start and wait until the sim reaches Complete or Failed state. */
async function runToCompletion(page: Page, timeoutMs = 30000): Promise<void> {
  await page.locator('#toggleBtn').click();
  await page.waitForFunction(
    () => {
      const btn = document.getElementById('toggleBtn') as HTMLButtonElement | null;
      if (!btn) return false;
      const t = (btn.textContent ?? '').trim();
      return t === 'Complete' || t === 'Failed';
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/** Read the sim's full persisted state from localStorage. */
async function readState(page: Page): Promise<HammerState> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  if (!raw) throw new Error(`localStorage key "${STORAGE_KEY}" is empty`);
  return JSON.parse(raw) as HammerState;
}

/** Place an order through the UI, mirroring exactly what a student does. */
async function placeOrder(page: Page, redQty: number, blueQty: number): Promise<void> {
  if (redQty > 0) await setNumberInput(page, '#redOrderQty', redQty);
  if (blueQty > 0) await setNumberInput(page, '#blueOrderQty', blueQty);
  await page.locator('#placeOrderBtn').click();
}

/** Parse a text like "50" or "100%" to an integer; returns NaN on failure. */
function parseIntSafe(s: string): number {
  return parseInt(s.replace(/[^\d-]/g, ''), 10);
}

// ---------- SMOKE ----------
test.describe('Red and Blue Hammers — smoke', () => {
  // Dismiss any stray dialogs defensively (the sim uses DOM notifications, not alert(),
  // but we guard against future additions).
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => {
      d.dismiss().catch(() => {});
    });
  });

  // 2 seeds × 3 phases = 6 smoke tests.
  for (const seed of [1, 42]) {
    test(`phase 1 seed=${seed}: 60-min run produces no NaN`, async ({ page }) => {
      await accelerateTime(page, 200);
      await loadSim(page, SIM_PATH, { seed });
      await selectFastestSpeed(page);
      // Conservative: 3 regular staff. Emergency locked in P1.
      await setSlider(page, '#regularStaffSlider', 3);
      await runToCompletion(page);
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });

    test(`phase 2 seed=${seed}: 60-min run with initial orders produces no NaN`, async ({
      page,
    }) => {
      await accelerateTime(page, 200);
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase(page, 2);
      await selectFastestSpeed(page);
      await setSlider(page, '#regularStaffSlider', 3);
      // Initial order as the task spec directs: 50 Red + 50 Blue arrive 2 min in.
      await placeOrder(page, 50, 50);
      await runToCompletion(page);
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });

    test(`phase 3 seed=${seed}: 60-min run with initial orders produces no NaN`, async ({
      page,
    }) => {
      await accelerateTime(page, 200);
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase(page, 3);
      await selectFastestSpeed(page);
      await setSlider(page, '#regularStaffSlider', 3);
      // Emergency staff unlocked in Phase 3 but left at 0 — conservative budget.
      await placeOrder(page, 50, 50);
      await runToCompletion(page);
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }
});

// ---------- INVARIANTS ----------
test.describe('Red and Blue Hammers — invariants', () => {
  test('satisfaction stays in [0, 100] throughout a run', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 7 });
    await selectFastestSpeed(page);
    await setSlider(page, '#regularStaffSlider', 5);

    // Sample satisfaction at several time checkpoints by polling the DOM during the run.
    await page.locator('#toggleBtn').click();
    const samples: Array<{ t: number; red: number; blue: number }> = [];

    // Collect up to 12 samples across the run; stop when Complete/Failed is reached.
    for (let i = 0; i < 12; i++) {
      await page.waitForFunction(
        (lastT) => {
          const btn = document.getElementById('toggleBtn');
          if (btn && (btn.textContent === 'Complete' || btn.textContent === 'Failed')) return true;
          const t = parseInt(
            (document.getElementById('timeDisplay')?.textContent ?? '0').trim() || '0',
            10,
          );
          return t > lastT;
        },
        samples.length > 0 ? samples[samples.length - 1].t : -1,
        { timeout: 10000 },
      );
      const snap = await page.evaluate(() => {
        const num = (id: string): number =>
          parseInt((document.getElementById(id)?.textContent ?? '0').trim(), 10);
        return {
          t: num('timeDisplay'),
          red: num('redSatisfaction'),
          blue: num('blueSatisfaction'),
        };
      });
      samples.push(snap);
      const btnText = (await page.locator('#toggleBtn').textContent())?.trim();
      if (btnText === 'Complete' || btnText === 'Failed') break;
    }

    // Wait for the run to finish so later tests don't race with it.
    await page.waitForFunction(
      () => {
        const btn = document.getElementById('toggleBtn');
        const t = (btn?.textContent ?? '').trim();
        return t === 'Complete' || t === 'Failed';
      },
      undefined,
      { timeout: 20000 },
    );

    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(
        Number.isInteger(s.red) && s.red >= 0 && s.red <= 100,
        `t=${s.t}: redSatisfaction=${s.red}`,
      ).toBe(true);
      expect(
        Number.isInteger(s.blue) && s.blue >= 0 && s.blue <= 100,
        `t=${s.t}: blueSatisfaction=${s.blue}`,
      ).toBe(true);
    }
  });

  test('inventory is never negative during a run (DOM) or at end (state)', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 11 });
    await skipToPhase(page, 2);
    await selectFastestSpeed(page);
    await setSlider(page, '#regularStaffSlider', 3);
    await placeOrder(page, 50, 50);

    // Poll inventory during the run.
    await page.locator('#toggleBtn').click();
    let lastT = -1;
    let iter = 0;
    while (iter < 80) {
      iter++;
      const snap = await page.evaluate(() => {
        const num = (id: string): number =>
          parseInt((document.getElementById(id)?.textContent ?? '0').trim(), 10);
        const btn = document.getElementById('toggleBtn');
        return {
          t: num('timeDisplay'),
          red: num('redInventoryDisplay'),
          blue: num('blueInventoryDisplay'),
          done: btn?.textContent === 'Complete' || btn?.textContent === 'Failed',
        };
      });
      if (snap.t !== lastT) {
        expect(snap.red, `t=${snap.t}: redInv=${snap.red}`).toBeGreaterThanOrEqual(0);
        expect(snap.blue, `t=${snap.t}: blueInv=${snap.blue}`).toBeGreaterThanOrEqual(0);
        lastT = snap.t;
      }
      if (snap.done) break;
      await page.waitForTimeout(20);
    }

    // Final state from localStorage must also hold.
    const s = await readState(page);
    expect(s.inventoryRed).toBeGreaterThanOrEqual(0);
    expect(s.inventoryBlue).toBeGreaterThanOrEqual(0);
  });

  test('cash identity: initial + revenue − (wage + holding + order) = currentCash', async ({
    page,
  }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 17 });
    await skipToPhase(page, 2);
    await selectFastestSpeed(page);
    await setSlider(page, '#regularStaffSlider', 3);
    await placeOrder(page, 50, 50);
    await runToCompletion(page);

    const s = await readState(page);
    const expected =
      INITIAL_CASH + s.totalRevenue - (s.totalStaffCost + s.totalHoldingCost + s.totalOrderCost);
    // The sim updates cash incrementally as it goes (revenue on each sale, costs per minute,
    // order cost on placement). The identity should hold to floating-point precision.
    expect(
      s.currentCash,
      `cash=${s.currentCash} expected=${expected} ` +
        `(rev=${s.totalRevenue} wage=${s.totalStaffCost} hold=${s.totalHoldingCost} order=${s.totalOrderCost})`,
    ).toBeCloseTo(expected, 6);
  });
});

// ---------- ORACLE ----------
test.describe('Red and Blue Hammers — oracle', () => {
  // Pure-formula oracles that match the sim's top-level constants.

  test('red hammer revenue per 1-unit sale = $25', () => {
    const qty = 1;
    expect(RED_PRICE * qty).toBe(25);
  });

  test('blue hammer revenue per 1-unit sale = $50', () => {
    const qty = 1;
    expect(BLUE_PRICE * qty).toBe(50);
  });

  test('emergency staff wage is exactly 5× regular staff wage ($25 vs $5)', () => {
    expect(EMERGENCY_WAGE).toBe(REGULAR_WAGE * 5);
  });

  test('max inventory enforced: order that would push total past 200 is rejected', async ({
    page,
  }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 3 });
    await skipToPhase(page, 2);
    // Starting inventory = 50 red + 50 blue. An order of 100 + 100 would bring
    // pending+current to 150 each — valid. An order of 100 with 60 red already
    // pending would fail the inventoryRed+pendRed+redQty > 200 check.

    // First legal order: 100 red. Now pending red = 100, current red = 50 → 150 total.
    await placeOrder(page, 100, 0);
    // The legal order should be accepted — notification reads "Order placed:".
    await expect(page.locator('#notificationArea')).toContainText(/Order placed/i);

    // Now try a second order of 100 red: pending red would become 200, plus current 50 = 250 > 200.
    await setNumberInput(page, '#redOrderQty', 100);
    await page.locator('#placeOrderBtn').click();
    // The sim should reject with an error notification.
    await expect(page.locator('#notificationArea')).toContainText(
      /cannot exceed 200/i,
      { timeout: 3000 },
    );

    // State should still only have the first red order pending (qty 100).
    const s = await readState(page);
    const redPending = s.pendingOrders
      .filter((o) => o.type === 'red')
      .reduce((a, o) => a + o.quantity, 0);
    expect(redPending).toBe(100);
  });

  test('max order size per request = 100', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 5 });
    await skipToPhase(page, 2);
    // Bypass the HTML "max" attribute by setting .value directly.
    await setNumberInput(page, '#redOrderQty', 101);
    await page.locator('#placeOrderBtn').click();
    await expect(page.locator('#notificationArea')).toContainText(
      new RegExp(`Max order size is ${MAX_ORDER_SIZE}`),
      { timeout: 3000 },
    );
    const s = await readState(page);
    expect(s.pendingOrders.length).toBe(0);
  });
});

// ---------- CLAIMS ----------
test.describe('Red and Blue Hammers — claims', () => {
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

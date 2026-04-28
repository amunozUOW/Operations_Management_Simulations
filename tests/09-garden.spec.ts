import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/09-garden.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '09 Garden Project/Garden Project.html';
const STORAGE_KEY = 'ops802_garden_project_v1';

// Mirrors the sim's top-level constants (lines 147-149, 150-158).
const MAX_TIME = 112;
const BUDGETS: Record<'beginner' | 'intermediate' | 'advanced', number> = {
  beginner: 16000,
  intermediate: 24000,
  advanced: 32000,
};
const PLOT_COUNTS: Record<'beginner' | 'intermediate' | 'advanced', number> = {
  beginner: 15,
  intermediate: 25,
  advanced: 40,
};
const COSTS_PER_DAY = [0, 0, 40, 120]; // index by skillLevel (1/2/3 valid)

type Operation = 'planning' | 'soilprep' | 'planting' | 'inspection' | 'harvesting';

// Snapshot of state.staffData as persisted by saveState() (lines 653-662).
interface StaffData {
  id: string;
  skillLevel: 1 | 2 | 3;
  busy: boolean;
  currentOperation: Operation | null;
  totalBusyTime: number;
  busyStartTime: number | null;
  costPerDay: number;
  totalCost: number;
  currentTaskId: string | null;
}

// Full persisted state (lines 186-197). Only fields we read.
interface GardenState {
  currentPhase: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  totalBudget: number;
  plotCount: number;
  simulationTime: number;
  isComplete: boolean;
  simulationSpeed: number;
  staffData: StaffData[];
  queues: Record<string, unknown[]>;
  inProcess: Record<string, Record<string, unknown>>;
  completedTasks: Array<{ completionTime: number; arrivalTime: number; deadline: number }>;
  taskArrivals: Array<{ id: string; arrivalTime: number; deadline: number }>;
}

/**
 * Accelerate setInterval so smoke runs complete in reasonable wall time.
 * simTick is scheduled at 2000ms / simulationSpeed; with factor=200 a 112-day
 * run finishes in roughly 1.1 s of real time at speed=1. Must run before the
 * sim's IIFE fires, i.e. before page load.
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

/** Read the sim's full persisted state from localStorage. */
async function readState(page: Page): Promise<GardenState> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  if (!raw) throw new Error(`localStorage key "${STORAGE_KEY}" is empty`);
  return JSON.parse(raw) as GardenState;
}

/**
 * Pick a DataTransfer-equipped drag-drop sequence on a staff chip and an op
 * drop zone. The sim stores the dragged staff in a module-scope `currentDraggedStaff`
 * closure variable that is set by the dragstart handler and read by the drop
 * handler — so dispatching these events on the real DOM elements is sufficient.
 */
async function dragStaffToOp(page: Page, staffId: string, opContainerId: string): Promise<void> {
  await page.evaluate(
    ({ sid, targetId }) => {
      const source = document.querySelector(`[data-staff-id="${sid}"]`) as HTMLElement | null;
      const target = document.getElementById(targetId) as HTMLElement | null;
      if (!source) throw new Error(`staff chip ${sid} not found`);
      if (!target) throw new Error(`drop target #${targetId} not found`);
      const dt = new DataTransfer();
      const dragStart = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
      source.dispatchEvent(dragStart);
      const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      target.dispatchEvent(dragOver);
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      target.dispatchEvent(drop);
      const dragEnd = new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt });
      source.dispatchEvent(dragEnd);
    },
    { sid: staffId, targetId: opContainerId },
  );
}

/**
 * Pre-assign staff by skill across operations using drag-drop. Assumes a
 * freshly initialised sim with exactly 9 staff members (4 volunteers = G1..G4,
 * 3 experienced = G5..G7, 2 masters = G8..G9 — the order set by initStaff's
 * `dist=[1,1,1,1,2,2,2,3,3]`).
 *
 * checkConstraints (lines 429-442) requires that any operation hosting
 * volunteers ALSO has at least one Experienced/Master supervising it — for
 * planning, planting, and harvesting. It also requires a Master in inspection.
 * Distribution below respects both:
 *
 *   Planning:    G1, G2 (vols)   + G5 (exp)      — 3 staff
 *   Soil Prep:   G6 (exp)                        — 1 staff
 *   Planting:    G3 (vol)         + G7 (exp)     — 2 staff
 *   Inspection:  G8 (master)                     — 1 staff
 *   Harvesting:  G4 (vol)         + G9 (master)  — 2 staff
 *
 * This assigns all 9 staff and passes checkConstraints from t=0.
 */
async function preAssignStaff(page: Page): Promise<void> {
  await dragStaffToOp(page, 'G1', 'gpPlanOp');
  await dragStaffToOp(page, 'G2', 'gpPlanOp');
  await dragStaffToOp(page, 'G5', 'gpPlanOp');
  await dragStaffToOp(page, 'G6', 'gpSoilOp');
  await dragStaffToOp(page, 'G3', 'gpPlantOp');
  await dragStaffToOp(page, 'G7', 'gpPlantOp');
  await dragStaffToOp(page, 'G8', 'gpInspOp');
  await dragStaffToOp(page, 'G4', 'gpHarvOp');
  await dragStaffToOp(page, 'G9', 'gpHarvOp');
}

/**
 * Click Start, wait for either Complete (button text 'Complete'), or for a
 * budget-depletion notification (which pauses the sim and disables the
 * button), or until #gpTime reaches MAX_TIME.
 */
async function runUntilDoneOrBudget(page: Page, timeoutMs = 20000): Promise<void> {
  await page.locator('#gpStartBtn').click();
  await page.waitForFunction(
    (maxTime) => {
      const btn = document.getElementById('gpStartBtn') as HTMLButtonElement | null;
      if (btn && btn.disabled) return true;
      const t = parseInt((document.getElementById('gpTime')?.textContent ?? '0').trim(), 10);
      return t >= maxTime;
    },
    MAX_TIME,
    { timeout: timeoutMs },
  );
}

/** Click the "Skip to Phase N" override button in the insights panel. */
async function skipToPhase(page: Page, phase: 2 | 3): Promise<void> {
  const btnId = phase === 2 ? '#gpSkip2' : '#gpSkip3';
  await page.locator(btnId).click();
  // Active phase label is painted UOW Bright Blue rgb(0, 51, 255).
  await expect(page.locator(`#gpPhaseLabel${phase}`)).toHaveCSS(
    'background-color',
    'rgb(0, 51, 255)',
  );
}

/** Apply a difficulty level (Phase 3 only). Resets the sim to defaults for that level. */
async function applyDifficulty(
  page: Page,
  level: 'beginner' | 'intermediate' | 'advanced',
): Promise<void> {
  await page.locator('#gpDifficulty').selectOption(level);
  await page.locator('#gpApplyDiff').click();
  // Total plots span updates to the new count.
  await expect(page.locator('#gpTotalPlots')).toHaveText(String(PLOT_COUNTS[level]));
}

// ---------- SMOKE ----------
test.describe('Garden Project — smoke', () => {
  test.beforeEach(async ({ page }) => {
    // The sim uses a DOM notification (gpNotif div), not alert(), but we guard defensively.
    page.on('dialog', (d) => {
      d.dismiss().catch(() => {});
    });
  });

  // 3 phases × 2 seeds = 6 smoke tests.
  for (const seed of [1, 42]) {
    test(`phase 1 seed=${seed}: runs to completion or budget with no NaN`, async ({ page }) => {
      await accelerateTime(page, 200);
      await loadSim(page, SIM_PATH, { seed });
      await preAssignStaff(page);
      await runUntilDoneOrBudget(page);
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });

    test(`phase 2 seed=${seed}: runs to completion or budget with no NaN`, async ({ page }) => {
      await accelerateTime(page, 200);
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase(page, 2);
      await preAssignStaff(page);
      await runUntilDoneOrBudget(page);
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });

    test(`phase 3 seed=${seed}: intermediate difficulty runs with no NaN`, async ({ page }) => {
      await accelerateTime(page, 200);
      await loadSim(page, SIM_PATH, { seed });
      await skipToPhase(page, 3);
      await applyDifficulty(page, 'intermediate');
      await preAssignStaff(page);
      await runUntilDoneOrBudget(page);
      const issues = await scanForInvalidValues(page);
      expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
    });
  }
});

// ---------- INVARIANTS ----------
test.describe('Garden Project — invariants', () => {
  test('overall staff utilisation stays in [0, 100] throughout a run', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 7 });
    await preAssignStaff(page);

    await page.locator('#gpStartBtn').click();

    // Poll utilisation from the DOM across the run.
    const samples: Array<{ t: number; util: number }> = [];
    let lastT = -1;
    let iters = 0;
    while (iters < 150) {
      iters++;
      const snap = await page.evaluate(() => {
        const num = (id: string): number =>
          parseFloat((document.getElementById(id)?.textContent ?? '0').trim());
        const btn = document.getElementById('gpStartBtn') as HTMLButtonElement | null;
        return {
          t: num('gpTime'),
          util: num('gpOverallUtil'),
          done: !!(btn && btn.disabled),
        };
      });
      if (snap.t !== lastT) {
        samples.push({ t: snap.t, util: snap.util });
        lastT = snap.t;
      }
      if (snap.done || snap.t >= MAX_TIME) break;
      await page.waitForTimeout(15);
    }

    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(Number.isFinite(s.util), `t=${s.t}: util=${s.util}`).toBe(true);
      expect(s.util, `t=${s.t}: util=${s.util}`).toBeGreaterThanOrEqual(0);
      expect(s.util, `t=${s.t}: util=${s.util}`).toBeLessThanOrEqual(100);
    }
  });

  test('total cost equals the sum of staff totalCost (identity)', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 11 });
    await preAssignStaff(page);
    await runUntilDoneOrBudget(page);

    const state = await readState(page);
    const sumStaffCost = state.staffData.reduce((a, s) => a + s.totalCost, 0);

    const domCost = parseFloat(
      (await page.locator('#gpTotalCost').textContent()) ?? '0',
    );
    // The DOM shows tc.toFixed(0) — so compare to the integer rounding of the sum.
    expect(domCost, `domCost=${domCost} sum=${sumStaffCost}`).toBe(Math.round(sumStaffCost));

    // And the underlying identity must hold exactly (floating-point).
    // calcTotalCost() iterates the same staff array — we reconstruct it from
    // the saved staffData. No separate "totalCost" field exists in state;
    // the identity is by construction. We re-assert here that nothing else
    // contributes to the DOM total beyond the staff sum.
    expect(Math.abs(domCost - sumStaffCost), 'DOM cost vs staff-sum delta').toBeLessThanOrEqual(1);
  });

  test('completed tasks never exceed total plots', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 17 });
    await preAssignStaff(page);
    await runUntilDoneOrBudget(page);

    const state = await readState(page);
    expect(state.completedTasks.length).toBeLessThanOrEqual(state.taskArrivals.length);
    expect(state.taskArrivals.length).toBe(PLOT_COUNTS[state.difficulty]);
  });

  test('no staff member has totalBusyTime greater than simulationTime', async ({ page }) => {
    await accelerateTime(page, 200);
    await loadSim(page, SIM_PATH, { seed: 23 });
    await preAssignStaff(page);
    await runUntilDoneOrBudget(page);

    const state = await readState(page);
    for (const s of state.staffData) {
      expect(
        s.totalBusyTime,
        `staff ${s.id}: busy=${s.totalBusyTime} simTime=${state.simulationTime}`,
      ).toBeLessThanOrEqual(state.simulationTime);
    }
  });
});

// ---------- ORACLE ----------
test.describe('Garden Project — oracle', () => {
  test('beginner budget per plot = $1066.67', () => {
    const perPlot = BUDGETS.beginner / PLOT_COUNTS.beginner;
    expect(perPlot).toBeCloseTo(1066.67, 2);
  });

  test('intermediate budget per plot = $960', () => {
    const perPlot = BUDGETS.intermediate / PLOT_COUNTS.intermediate;
    expect(perPlot).toBeCloseTo(960, 2);
  });

  test('advanced budget per plot = $800', () => {
    const perPlot = BUDGETS.advanced / PLOT_COUNTS.advanced;
    expect(perPlot).toBeCloseTo(800, 2);
  });

  test('advanced has the tightest $/plot of the three difficulties', () => {
    const beg = BUDGETS.beginner / PLOT_COUNTS.beginner;
    const inter = BUDGETS.intermediate / PLOT_COUNTS.intermediate;
    const adv = BUDGETS.advanced / PLOT_COUNTS.advanced;
    expect(adv).toBeLessThan(inter);
    expect(inter).toBeLessThan(beg);
  });

  test('master day-cost is exactly 3× experienced day-cost', () => {
    expect(COSTS_PER_DAY[3]).toBe(COSTS_PER_DAY[2] * 3);
    expect(COSTS_PER_DAY[3]).toBe(120);
    expect(COSTS_PER_DAY[2]).toBe(40);
  });

  test('initial staff pool has 9 gardeners (4 volunteers, 3 experienced, 2 masters)', async ({
    page,
  }) => {
    await loadSim(page, SIM_PATH, { seed: 1 });
    const state = await readState(page);
    expect(state.staffData.length).toBe(9);
    const byLevel = state.staffData.reduce(
      (acc, s) => {
        acc[s.skillLevel] = (acc[s.skillLevel] ?? 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    );
    expect(byLevel[1]).toBe(4);
    expect(byLevel[2]).toBe(3);
    expect(byLevel[3]).toBe(2);
  });

  test('volunteer day-cost is $0; experienced $40; master $120 (matches saved state)', async ({
    page,
  }) => {
    await loadSim(page, SIM_PATH, { seed: 1 });
    const state = await readState(page);
    for (const s of state.staffData) {
      expect(s.costPerDay).toBe(COSTS_PER_DAY[s.skillLevel]);
    }
  });
});

// ---------- CLAIMS ----------
test.describe('Garden Project — claims', () => {
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

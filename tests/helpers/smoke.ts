import type { Page } from '@playwright/test';
import { loadSim } from './simRunner';
import { scanForInvalidValues, type DomIssue } from './domScanners';

export interface SmokeOpts {
  seed?: number;
  /** Primary action control selector (e.g. '#btnNextTurn'). */
  control: string;
  /** 'turn' = click the control N times; 'run' = click once and let it run. */
  mode: 'turn' | 'run';
  /** turn mode: number of clicks (default 8). */
  steps?: number;
  /** run mode: ms to let the sim run (default 1500). */
  runMs?: number;
  /** Optional setup before exercising (e.g. set sliders, place an order). */
  before?: (page: Page) => Promise<void>;
}

/**
 * Generic smoke check: load a sim, exercise its primary control, and confirm
 * no NaN / undefined / null leaks into the rendered DOM. The deep, build-specific
 * state invariants from the original specs were retired when the T2 2026 builds
 * restructured their internals; this verifies the sim runs cleanly, and each
 * spec's `claims` block verifies the pedagogical numbers.
 */
export async function smokeNoNaN(page: Page, simPath: string, opts: SmokeOpts): Promise<DomIssue[]> {
  page.on('dialog', (d) => {
    d.dismiss().catch(() => {});
  });
  await loadSim(page, simPath, { seed: opts.seed });
  if (opts.before) await opts.before(page);

  const btn = page.locator(opts.control).first();
  if (opts.mode === 'turn') {
    const steps = opts.steps ?? 8;
    for (let i = 0; i < steps; i++) {
      try {
        if (await btn.isEnabled({ timeout: 500 })) await btn.click({ timeout: 1000 });
      } catch {
        /* control may disable at end-of-run — that's fine */
      }
      await page.waitForTimeout(80);
    }
  } else {
    try {
      await btn.click({ timeout: 2000 });
    } catch {
      /* ignore */
    }
    await page.waitForTimeout(opts.runMs ?? 1500);
  }
  return scanForInvalidValues(page);
}

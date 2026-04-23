import type { Page } from '@playwright/test';
import { installSeededRandom } from './seed';
import path from 'path';

export interface LoadOptions {
  /** Seed for deterministic Math.random. If omitted, Math.random stays unseeded. */
  seed?: number;
  /** Clear localStorage before loading. Default: true. */
  clearStorage?: boolean;
}

/**
 * Load a simulation HTML file into a Playwright page with optional
 * deterministic PRNG seeding and a cleared localStorage.
 *
 * @param relativePath Path relative to repo root, e.g. "07 Supply Chain/Supply Chain.html"
 */
export async function loadSim(page: Page, relativePath: string, opts: LoadOptions = {}): Promise<void> {
  const { seed, clearStorage = true } = opts;

  if (seed !== undefined) {
    await installSeededRandom(page, seed);
  }

  const absPath = path.resolve(__dirname, '..', '..', relativePath);
  const url = `file://${absPath}`;

  if (clearStorage) {
    // Navigate to the sim URL first so we're on the right origin, then clear storage, then reload.
    // This mirrors how a fresh user visit would look.
    await page.goto(url);
    try {
      await page.evaluate(() => localStorage.clear());
    } catch {
      /* ignore */
    }
    await page.reload();
  } else {
    await page.goto(url);
  }

  await page.waitForLoadState('domcontentloaded');
}

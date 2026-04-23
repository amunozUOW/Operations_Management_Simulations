import type { Page } from '@playwright/test';

/**
 * Replace Math.random in the page with a seeded mulberry32 PRNG
 * so tests can produce deterministic output. Runs on every navigation.
 */
export async function installSeededRandom(page: Page, seed: number): Promise<void> {
  await page.addInitScript((s: number) => {
    let state = s >>> 0;
    (Math as any).random = function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
}

import { test, expect } from '@playwright/test';
import { loadSim } from './simRunner';

test('loads Supply Chain without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await loadSim(page, '07 Supply Chain/Supply Chain.html', { seed: 1 });
  await expect(page.locator('#turnCounter')).toBeVisible();
  expect(errors).toEqual([]);
});

test('clears localStorage between loads', async ({ page }) => {
  await loadSim(page, '07 Supply Chain/Supply Chain.html');
  await page.evaluate(() => localStorage.setItem('ops802_supply_chain_v1', 'STALE'));
  await loadSim(page, '07 Supply Chain/Supply Chain.html');
  const v = await page.evaluate(() => localStorage.getItem('ops802_supply_chain_v1'));
  expect(v).not.toBe('STALE');
});

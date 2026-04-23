import { test, expect, Page } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { foodTruck } from './helpers/oracles';
import { evalFormula } from './helpers/formulaEval';
import claimsJson from './claims/02-food-truck.json' with { type: 'json' };
import type { ClaimsFile } from './helpers/claims';

const claims = claimsJson as ClaimsFile;
const SIM_PATH = '02 The (Un)Productive Food Truck/food truck sim.html';

async function setStaff(page: Page, n: number): Promise<void> {
  await page.locator('#staffCount').evaluate((el, v) => {
    (el as HTMLInputElement).value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
}

async function runDay(page: Page): Promise<void> {
  const before = await page.locator('#dayCounter').textContent();
  await page.locator('#runDayBtn').click();
  await page.waitForFunction((prev) => {
    const el = document.getElementById('dayCounter');
    return !!(el && el.textContent && el.textContent !== prev);
  }, before);
}

test.describe('Food Truck — smoke', () => {
  for (const staff of [1, 3, 5, 10]) {
    for (const seed of [1, 42]) {
      test(`staff=${staff} seed=${seed}: 5 days produce no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await setStaff(page, staff);
        for (let i = 0; i < 5; i++) await runDay(page);
        const issues = await scanForInvalidValues(page);
        expect(issues, `Invalid values: ${JSON.stringify(issues)}`).toEqual([]);
      });
    }
  }
});

test.describe('Food Truck — invariants', () => {
  test('SFP never exceeds 12', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 7 });
    for (const staff of [1, 2, 5, 10]) {
      await setStaff(page, staff);
      await runDay(page);
      const sfp = await page.locator('#sfpValue').textContent();
      expect(parseFloat(sfp!)).toBeLessThanOrEqual(12 + 1e-9);
    }
  });

  test('profit = revenue − totalCosts within 1 cent', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 99 });
    await setStaff(page, 3);
    await runDay(page);
    const rev = parseFloat((await page.locator('#revenue').textContent())!);
    const cost = parseFloat((await page.locator('#totalCosts').textContent())!);
    const profitTxt = (await page.locator('#dailyProfit').textContent())!;
    const profit = parseFloat(profitTxt.replace(/[^0-9.\-]/g, ''));
    expect(profit).toBeCloseTo(rev - cost, 2);
  });

  test('actualCustomers ≤ min(demand, capacity)', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 13 });
    for (const staff of [1, 4, 8]) {
      await setStaff(page, staff);
      await runDay(page);
      const capacity = parseInt((await page.locator('#serviceCapacity').textContent())!, 10);
      const demand = parseInt((await page.locator('#potentialDemand').textContent())!, 10);
      const served = parseInt((await page.locator('#customersServed').textContent())!, 10);
      expect(served).toBeLessThanOrEqual(Math.min(demand, capacity));
    }
  });
});

test.describe('Food Truck — oracle', () => {
  test('capacity = staff × 96 matches UI', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 3 });
    for (const staff of [1, 3, 7, 10]) {
      await setStaff(page, staff);
      await runDay(page);
      const capTxt = await page.locator('#serviceCapacity').textContent();
      expect(parseInt(capTxt!, 10)).toBe(foodTruck.capacity(staff));
    }
  });

  test('wages = staff × $120 reflected in totalCosts', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 21 });
    for (const staff of [2, 5]) {
      await setStaff(page, staff);
      await runDay(page);
      const totalCosts = parseFloat((await page.locator('#totalCosts').textContent())!);
      expect(totalCosts).toBeCloseTo(foodTruck.totalCost(staff), 2);
    }
  });
});

test.describe('Food Truck — claims', () => {
  for (const c of claims.claims) {
    if (c.type === 'formula' && c.formula && c.inputs && c.expected !== undefined) {
      test(`claim: ${c.id}`, () => {
        const result = evalFormula(c.formula!, c.inputs!);
        const tol = c.tolerance ?? 0;
        expect(Math.abs(result - (c.expected as number))).toBeLessThanOrEqual(tol);
      });
    }
  }
});

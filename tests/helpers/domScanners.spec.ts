import { test, expect } from '@playwright/test';
import { scanForInvalidValues } from './domScanners';

test('detects NaN in text content', async ({ page }) => {
  await page.setContent('<div id="m">NaN</div>');
  const issues = await scanForInvalidValues(page);
  expect(issues).toHaveLength(1);
  expect(issues[0].value).toBe('NaN');
});

test('detects $NaN and NaN% patterns', async ({ page }) => {
  await page.setContent('<div>$NaN</div><div>NaN%</div>');
  const issues = await scanForInvalidValues(page);
  expect(issues).toHaveLength(2);
});

test('detects literal undefined', async ({ page }) => {
  await page.setContent('<div>undefined</div>');
  const issues = await scanForInvalidValues(page);
  expect(issues).toHaveLength(1);
});

test('accepts valid numbers', async ({ page }) => {
  await page.setContent('<div>$100.00</div><div>42</div><div>3.14</div>');
  const issues = await scanForInvalidValues(page);
  expect(issues).toEqual([]);
});

test('ignores em-dash placeholder', async ({ page }) => {
  await page.setContent('<div>\u2014</div>');
  const issues = await scanForInvalidValues(page);
  expect(issues).toEqual([]);
});

test('ignores words like "undefined" in prose attributes', async ({ page }) => {
  await page.setContent('<div>Canadian band</div>');
  const issues = await scanForInvalidValues(page);
  expect(issues).toEqual([]);
});

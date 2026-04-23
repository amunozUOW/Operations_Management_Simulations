import { test, expect } from '@playwright/test';
import { installSeededRandom } from './seed';

const HTML = 'data:text/html,<html><body><script>window.__out=[Math.random(),Math.random(),Math.random()];</script></body></html>';

test('seeded Math.random is deterministic across reloads', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  await installSeededRandom(p1, 42);
  await p1.goto(HTML);
  const first = await p1.evaluate(() => (window as any).__out);
  await ctx1.close();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await installSeededRandom(p2, 42);
  await p2.goto(HTML);
  const second = await p2.evaluate(() => (window as any).__out);
  await ctx2.close();

  expect(first).toEqual(second);
  expect(first[0]).not.toEqual(first[1]);
});

test('different seeds produce different sequences', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  await installSeededRandom(p1, 1);
  await p1.goto(HTML);
  const s1 = await p1.evaluate(() => (window as any).__out);
  await ctx1.close();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await installSeededRandom(p2, 2);
  await p2.goto(HTML);
  const s2 = await p2.evaluate(() => (window as any).__out);
  await ctx2.close();

  expect(s1).not.toEqual(s2);
});

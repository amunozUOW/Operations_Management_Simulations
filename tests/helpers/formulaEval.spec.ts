import { test, expect } from '@playwright/test';
import { evalFormula } from './formulaEval';

test('evaluates sqrt(2*D*S/H)', () => {
  expect(evalFormula('sqrt(2 * D * S / H)', { D: 10, S: 130, H: 1 })).toBeCloseTo(Math.sqrt(2600), 5);
});

test('evaluates exp()', () => {
  expect(evalFormula('300 * exp(-0.1 * abs(price - 12))', { price: 12 })).toBeCloseTo(300, 5);
});

test('rejects unknown symbols', () => {
  expect(() => evalFormula('undefinedVar + 1', {})).toThrow(/Unknown symbol/);
});

test('rejects eval escape attempts', () => {
  expect(() => evalFormula('require("fs")', {})).toThrow(/Unknown symbol/);
});

test('arithmetic composition', () => {
  expect(evalFormula('(a + b) * c', { a: 2, b: 3, c: 4 })).toBe(20);
});

import { test, expect } from '@playwright/test';
import { supplyChainFulfill, SupplyChainState, foodTruck, mangoes, supermarket, vending } from './oracles';

test.describe('Supply Chain oracle', () => {
  test('idle turn with full inventory matches sim expectation', () => {
    const s: SupplyChainState = {
      factoryI: [12], factoryR: [12], factoryB: [0],
      retailerI: [12], retailerR: [12], retailerB: [0],
      retailerSales: [0],
    };
    supplyChainFulfill(s, 1, 5, 5, 5);
    expect(s.factoryI[1]).toBe(19);
    expect(s.retailerI[1]).toBe(19);
    expect(s.retailerSales[1]).toBe(5);
  });

  test('backlog creation when demand exceeds all inventory', () => {
    const s: SupplyChainState = {
      factoryI: [0], factoryR: [0], factoryB: [0],
      retailerI: [0], retailerR: [0], retailerB: [0],
      retailerSales: [0],
    };
    supplyChainFulfill(s, 1, 10, 10, 5);
    expect(s.retailerB[1]).toBeGreaterThan(0);
    expect(s.retailerSales[1]).toBe(0);
  });
});

test.describe('Food Truck oracle', () => {
  test('capacity formula', () => {
    expect(foodTruck.capacity(3)).toBe(3 * 12 * 8);
    expect(foodTruck.capacity(1)).toBe(96);
  });
  test('demand peaks at optimal price', () => {
    const peak = foodTruck.demandDeterministic(12);
    expect(foodTruck.demandDeterministic(10)).toBeLessThan(peak);
    expect(foodTruck.demandDeterministic(14)).toBeLessThan(peak);
    expect(peak).toBeCloseTo(300, 5);
  });
  test('profit = revenue - totalCost tautology', () => {
    const rev = 3000;
    const tc = foodTruck.totalCost(3);
    expect(rev - tc).toBe(rev - (3 * 8 * 15 + 2000));
  });
});

test.describe('Mangoes oracle', () => {
  test('EOQ formula', () => {
    expect(mangoes.eoq(633, 1000, 0.1)).toBeCloseTo(Math.sqrt(2 * 633 * 1000 / 0.1), 5);
    expect(mangoes.eoq(633, 150, 0.7)).toBeCloseTo(Math.sqrt(2 * 633 * 150 / 0.7), 5);
  });
  test('Phase 2 EOQ dramatically smaller than Phase 1', () => {
    const p1 = mangoes.eoq(633, 1000, 0.1);
    const p2 = mangoes.eoq(633, 150, 0.7);
    expect(p2 / p1).toBeLessThan(0.2);
  });
});

test.describe('Supermarket oracle', () => {
  test('capacity = (60/serviceTime) * counters', () => {
    expect(supermarket.capacity(5, 3)).toBe(100);
    expect(supermarket.capacity(5, 6)).toBe(50);
  });
  test('utilization capped at 100%', () => {
    expect(supermarket.utilization(200, 50)).toBe(100);
    expect(supermarket.utilization(25, 50)).toBe(50);
  });
  test('throughput time', () => {
    expect(supermarket.throughputTime(60, 5, 4)).toBe(48);
  });
});

test.describe('Vending oracle', () => {
  test('EOQ 10 demand/130 cost/1 holding ≈ 51', () => {
    expect(vending.eoq(10, 130, 1)).toBeCloseTo(Math.sqrt(2600), 5);
    expect(Math.round(vending.eoq(10, 130, 1))).toBe(51);
  });
  test('Reorder point = demand × lead time', () => {
    expect(vending.rop(10, 3)).toBe(30);
  });
  test('Safety stock = (max - avg) × lead time', () => {
    expect(vending.safetyStock(15, 10, 3)).toBe(15);
  });
});

// Reference implementations of each simulation's documented math.
// Tests compare these against what the sims produce in the DOM.

export interface SupplyChainState {
  factoryI: number[]; factoryR: number[]; factoryB: number[];
  retailerI: number[]; retailerR: number[]; retailerB: number[];
  retailerSales: number[];
}

/**
 * Mirror of processEchelonFulfill in 07 Supply Chain/Supply Chain.html.
 * Kept byte-for-byte in sync with the sim source; any formula change must update both.
 */
function processEchelon(
  t: number,
  eI: number[], eR: number[], eB: number[],
  downOrder: number, downR: number[],
): void {
  if ((eI[t - 1] + eR[t - 1]) <= 0) {
    if (eR[t - 1] === 0) { downR[t] = 0; eB[t] = eB[t - 1] + downOrder; eI[t] = -eB[t]; }
    if (eR[t - 1] > 0 && eR[t - 1] < downOrder) { downR[t] = eR[t - 1]; eB[t] = eB[t - 1] + downOrder - eR[t - 1]; eI[t] = -eB[t]; }
    if (eR[t - 1] >= downOrder) {
      if (eR[t - 1] >= downOrder + eB[t - 1]) { downR[t] = eB[t - 1] + downOrder; eB[t] = 0; eI[t] = eR[t - 1] - downR[t]; }
      else { downR[t] = eR[t - 1]; eB[t] = downOrder + eB[t - 1] - eR[t - 1]; eI[t] = -eB[t]; }
    }
  }
  if ((eI[t - 1] + eR[t - 1]) > 0) {
    if (eI[t - 1] + eR[t - 1] < downOrder) {
      if (eB[t - 1] === 0) { downR[t] = eI[t - 1] + eR[t - 1]; eB[t] = downOrder - downR[t]; eI[t] = -eB[t]; }
      else { downR[t] = eR[t - 1]; eB[t] = eB[t - 1] + downOrder - eR[t - 1]; eI[t] = -eB[t]; }
    }
    if (eI[t - 1] + eR[t - 1] >= downOrder && eB[t - 1] === 0) {
      downR[t] = downOrder; eB[t] = 0; eI[t] = eI[t - 1] + eR[t - 1] - downOrder;
    }
    if (eI[t - 1] + eR[t - 1] >= downOrder && eB[t - 1] > 0) {
      if (eR[t - 1] >= eB[t - 1] + downOrder) { downR[t] = eB[t - 1] + downOrder; eB[t] = 0; eI[t] = eR[t - 1] - downR[t]; }
      else { downR[t] = eR[t - 1]; eB[t] = eB[t - 1] + downOrder - eR[t - 1]; eI[t] = -eB[t]; }
    }
  }
}

/** Drive one turn of the 2-echelon Supply Chain model. */
export function supplyChainFulfill(
  s: SupplyChainState, t: number,
  factoryOrder: number, retailerOrder: number, demand: number,
): void {
  s.factoryR[t] = factoryOrder;
  processEchelon(t, s.factoryI, s.factoryR, s.factoryB, retailerOrder, s.retailerR);
  processEchelon(t, s.retailerI, s.retailerR, s.retailerB, demand, s.retailerSales);
}

/** Food Truck formulas. */
export const foodTruck = {
  capacity: (staff: number, hoursPerDay = 8, custPerStaffHour = 12): number =>
    staff * custPerStaffHour * hoursPerDay,
  demandDeterministic: (price: number, base = 300, optimal = 12): number =>
    base * Math.exp(-0.1 * Math.abs(price - optimal)),
  wages: (staff: number, hoursPerDay = 8, hourlyWage = 15): number =>
    staff * hoursPerDay * hourlyWage,
  totalCost: (staff: number, fixedOverhead = 2000): number =>
    foodTruck.wages(staff) + fixedOverhead,
  sfp: (customers: number, staff: number, hours = 8): number =>
    customers / (staff * hours),
  mfp: (revenue: number, totalCost: number): number => revenue / totalCost,
};

/** Mangoes Economic Order Quantity. */
export const mangoes = {
  eoq: (D: number, S: number, H: number): number => Math.sqrt(2 * D * S / H),
};

/** Supermarket checkout formulas. */
export const supermarket = {
  capacity: (counters: number, serviceTime: number): number =>
    (60 / serviceTime) * counters,
  utilization: (demand: number, capacity: number): number =>
    Math.min(demand / capacity * 100, 100),
  throughputTime: (demand: number, counters: number, serviceTime: number): number =>
    (serviceTime * demand) / counters,
};

/** Vending machine inventory formulas. */
export const vending = {
  eoq: (D: number, S: number, H: number): number => Math.sqrt(2 * D * S / H),
  rop: (demandPerDay: number, leadTime: number): number => demandPerDay * leadTime,
  safetyStock: (maxDemandPerDay: number, avgDemandPerDay: number, leadTime: number): number =>
    (maxDemandPerDay - avgDemandPerDay) * leadTime,
};

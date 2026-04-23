# Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Playwright-based test suite that exercises all nine simulations end-to-end, verifies math correctness, and validates pedagogical claims — running locally via `npm test` and in GitHub Actions CI.

**Architecture:** Single Playwright project at repo root loads each `.html` sim in headless Chromium. Four test layers per sim: smoke (no NaN), invariants (properties that always hold), numerical oracle (deterministic reference implementations), and claims (insight-panel + .docx lesson-plan statements). Determinism via `page.addInitScript` injecting a seeded `mulberry32` PRNG. Same test code runs locally and in CI.

**Tech Stack:** Node 20, Playwright (TypeScript), Chart.js (already used by sims, no change), mammoth (one-off .docx text extraction), GitHub Actions.

**Design doc:** `docs/plans/2026-04-23-test-suite-design.md`

**Preconditions:**
- Repo already contains nine `NN Simulation/*.html` files at the root.
- The Supply Chain NaN fix (commit `e28cea3`) is already merged.

---

## Phase A — Scaffolding

### Task 1: Initialize `package.json`

**Files:**
- Create: `package.json`

**Step 1: Create file**

```json
{
  "name": "operations-management-simulations-tests",
  "version": "1.0.0",
  "private": true,
  "description": "Test suite for Operations Management Simulations",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:debug": "playwright test --debug",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^20.17.0",
    "mammoth": "^1.8.0",
    "typescript": "^5.6.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**Step 2: Install**

Run: `npm install`
Expected: `added <N> packages` with no errors. `node_modules/` and `package-lock.json` created.

**Step 3: Install Playwright browser**

Run: `npx playwright install chromium`
Expected: Chromium downloaded to `~/.cache/ms-playwright/`.

**Step 4: Add entries to `.gitignore`**

Modify: `.gitignore` — append:
```
node_modules/
playwright-report/
test-results/
```

**Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore(test): initialise npm project and Playwright"
```

---

### Task 2: Add Playwright config

**Files:**
- Create: `playwright.config.ts`

**Step 1: Write file**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: `file://${__dirname}/`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

**Step 2: Verify config loads**

Run: `npx playwright test --list`
Expected: `No tests found.` (not an error — tests haven't been written yet).

**Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "chore(test): add Playwright config"
```

---

### Task 3: Add TypeScript config

**Files:**
- Create: `tsconfig.json`

**Step 1: Write file**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["tests/**/*", "playwright.config.ts"]
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No output (success).

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore(test): add TypeScript config"
```

---

### Task 4: Add GitHub Actions workflow

**Files:**
- Create: `.github/workflows/test.yml`

**Step 1: Create directories and file**

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Playwright tests
    timeout-minutes: 10
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Cache Playwright browsers
        id: playwright-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright Chromium
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      - name: Install Playwright system deps
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - name: Run tests
        run: npx playwright test

      - name: Upload report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

**Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add Playwright workflow"
```

---

## Phase B — Test helpers (TDD)

### Task 5: Implement `seed.ts` (deterministic PRNG helper)

**Files:**
- Test: `tests/helpers/seed.spec.ts`
- Create: `tests/helpers/seed.ts`

**Step 1: Write failing test**

```typescript
// tests/helpers/seed.spec.ts
import { test, expect } from '@playwright/test';
import { installSeededRandom } from './seed';

test('seeded Math.random is deterministic across reloads', async ({ page }) => {
  await installSeededRandom(page, 42);
  await page.setContent('<html><body><script>window.__out = [Math.random(), Math.random(), Math.random()];</script></body></html>');
  const first = await page.evaluate(() => (window as any).__out);

  await installSeededRandom(page, 42);
  await page.setContent('<html><body><script>window.__out = [Math.random(), Math.random(), Math.random()];</script></body></html>');
  const second = await page.evaluate(() => (window as any).__out);

  expect(first).toEqual(second);
  expect(first[0]).not.toEqual(first[1]); // non-constant
});

test('different seeds produce different sequences', async ({ page }) => {
  await installSeededRandom(page, 1);
  await page.setContent('<html><body><script>window.__out = [Math.random(), Math.random()];</script></body></html>');
  const s1 = await page.evaluate(() => (window as any).__out);

  await installSeededRandom(page, 2);
  await page.setContent('<html><body><script>window.__out = [Math.random(), Math.random()];</script></body></html>');
  const s2 = await page.evaluate(() => (window as any).__out);

  expect(s1).not.toEqual(s2);
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test tests/helpers/seed.spec.ts`
Expected: FAIL — `Cannot find module './seed'` or similar.

**Step 3: Implement `seed.ts`**

```typescript
// tests/helpers/seed.ts
import type { Page } from '@playwright/test';

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
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test tests/helpers/seed.spec.ts`
Expected: 2 passed.

**Step 5: Commit**

```bash
git add tests/helpers/seed.ts tests/helpers/seed.spec.ts
git commit -m "test(helpers): add seeded Math.random helper"
```

---

### Task 6: Implement `domScanners.ts` (NaN/undefined detection)

**Files:**
- Test: `tests/helpers/domScanners.spec.ts`
- Create: `tests/helpers/domScanners.ts`

**Step 1: Write failing test**

```typescript
// tests/helpers/domScanners.spec.ts
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
```

**Step 2: Run to verify failure**

Run: `npx playwright test tests/helpers/domScanners.spec.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// tests/helpers/domScanners.ts
import type { Page } from '@playwright/test';

export interface DomIssue {
  selector: string;
  value: string;
}

export async function scanForInvalidValues(page: Page): Promise<DomIssue[]> {
  return page.evaluate(() => {
    const issues: DomIssue[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    const badPattern = /(^|[^A-Za-z])(NaN|undefined|null)($|[^A-Za-z])/;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (!txt) continue;
      if (badPattern.test(txt)) {
        const el = node.parentElement;
        const selector = el
          ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
          : '<text>';
        issues.push({ selector, value: txt });
      }
    }
    return issues;
  });
}
```

**Step 4: Run to verify pass**

Run: `npx playwright test tests/helpers/domScanners.spec.ts`
Expected: 5 passed.

**Step 5: Commit**

```bash
git add tests/helpers/domScanners.ts tests/helpers/domScanners.spec.ts
git commit -m "test(helpers): add DOM scanner for NaN/undefined"
```

---

### Task 7: Implement `simRunner.ts` (loads a sim and drives common actions)

**Files:**
- Test: `tests/helpers/simRunner.spec.ts`
- Create: `tests/helpers/simRunner.ts`

**Step 1: Write failing test**

```typescript
// tests/helpers/simRunner.spec.ts
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
  // After reload, either empty or a freshly-written state — not "STALE"
  expect(v).not.toBe('STALE');
});
```

**Step 2: Verify fail**

Run: `npx playwright test tests/helpers/simRunner.spec.ts`
Expected: FAIL.

**Step 3: Implement**

```typescript
// tests/helpers/simRunner.ts
import type { Page } from '@playwright/test';
import { installSeededRandom } from './seed';
import path from 'path';

export interface LoadOptions {
  seed?: number;
  clearStorage?: boolean;  // default true
}

export async function loadSim(page: Page, relativePath: string, opts: LoadOptions = {}): Promise<void> {
  const { seed, clearStorage = true } = opts;
  if (clearStorage) {
    // Navigate to about:blank first so we have a page context to clear storage on
    await page.goto('about:blank');
    try {
      await page.evaluate(() => {
        try { localStorage.clear(); } catch {}
      });
    } catch { /* first load, nothing to clear */ }
  }
  if (seed !== undefined) {
    await installSeededRandom(page, seed);
  }
  const absPath = path.resolve(__dirname, '..', '..', relativePath);
  await page.goto(`file://${absPath}`);
  await page.waitForLoadState('domcontentloaded');
}
```

**Step 4: Verify pass**

Run: `npx playwright test tests/helpers/simRunner.spec.ts`
Expected: 2 passed.

**Step 5: Commit**

```bash
git add tests/helpers/simRunner.ts tests/helpers/simRunner.spec.ts
git commit -m "test(helpers): add sim loader helper"
```

---

### Task 8: Implement `oracles.ts` — Supply Chain reference

**Files:**
- Test: `tests/helpers/oracles.spec.ts`
- Create: `tests/helpers/oracles.ts`

**Step 1: Write failing test (table-driven)**

```typescript
// tests/helpers/oracles.spec.ts
import { test, expect } from '@playwright/test';
import { supplyChainFulfill, SupplyChainState } from './oracles';

test('supply chain oracle: idle turn with full inventory matches sim', () => {
  const s: SupplyChainState = {
    factoryI: [12], factoryR: [12], factoryB: [0],
    retailerI: [12], retailerR: [12], retailerB: [0],
    retailerSales: [0],
  };
  // Retailer orders 5, demand 5
  supplyChainFulfill(s, 1, /*factoryOrder*/ 5, /*retailerOrder*/ 5, /*demand*/ 5);
  expect(s.factoryI[1]).toBe(19);     // 12 + 12 − 5
  expect(s.retailerI[1]).toBe(19);
  expect(s.retailerSales[1]).toBe(5);
});

test('supply chain oracle: backlog creation when demand > inventory', () => {
  const s: SupplyChainState = {
    factoryI: [0], factoryR: [0], factoryB: [0],
    retailerI: [0], retailerR: [0], retailerB: [0],
    retailerSales: [0],
  };
  supplyChainFulfill(s, 1, 10, 10, 5);
  expect(s.retailerB[1]).toBeGreaterThan(0);
});
```

**Step 2: Verify fail**

Run: `npx playwright test tests/helpers/oracles.spec.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// tests/helpers/oracles.ts

/** Reference implementation mirroring `processEchelonFulfill` in Supply Chain.html. */
export interface SupplyChainState {
  factoryI: number[]; factoryR: number[]; factoryB: number[];
  retailerI: number[]; retailerR: number[]; retailerB: number[];
  retailerSales: number[];
}

function processEchelon(
  t: number,
  eI: number[], eR: number[], eB: number[],
  downOrder: number, downR: number[],
): void {
  if ((eI[t-1] + eR[t-1]) <= 0) {
    if (eR[t-1] === 0) { downR[t] = 0; eB[t] = eB[t-1] + downOrder; eI[t] = -eB[t]; }
    if (eR[t-1] > 0 && eR[t-1] < downOrder) { downR[t] = eR[t-1]; eB[t] = eB[t-1] + downOrder - eR[t-1]; eI[t] = -eB[t]; }
    if (eR[t-1] >= downOrder) {
      if (eR[t-1] >= downOrder + eB[t-1]) { downR[t] = eB[t-1] + downOrder; eB[t] = 0; eI[t] = eR[t-1] - downR[t]; }
      else { downR[t] = eR[t-1]; eB[t] = downOrder + eB[t-1] - eR[t-1]; eI[t] = -eB[t]; }
    }
  }
  if ((eI[t-1] + eR[t-1]) > 0) {
    if (eI[t-1] + eR[t-1] < downOrder) {
      if (eB[t-1] === 0) { downR[t] = eI[t-1] + eR[t-1]; eB[t] = downOrder - downR[t]; eI[t] = -eB[t]; }
      else { downR[t] = eR[t-1]; eB[t] = eB[t-1] + downOrder - eR[t-1]; eI[t] = -eB[t]; }
    }
    if (eI[t-1] + eR[t-1] >= downOrder && eB[t-1] === 0) {
      downR[t] = downOrder; eB[t] = 0; eI[t] = eI[t-1] + eR[t-1] - downOrder;
    }
    if (eI[t-1] + eR[t-1] >= downOrder && eB[t-1] > 0) {
      if (eR[t-1] >= eB[t-1] + downOrder) { downR[t] = eB[t-1] + downOrder; eB[t] = 0; eI[t] = eR[t-1] - downR[t]; }
      else { downR[t] = eR[t-1]; eB[t] = eB[t-1] + downOrder - eR[t-1]; eI[t] = -eB[t]; }
    }
  }
}

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
  capacity: (staff: number, hoursPerDay = 8, custPerStaffHour = 12) => staff * custPerStaffHour * hoursPerDay,
  demandDeterministic: (price: number, base = 300, optimal = 12) => base * Math.exp(-0.1 * Math.abs(price - optimal)),
  wages: (staff: number, hoursPerDay = 8, hourlyWage = 15) => staff * hoursPerDay * hourlyWage,
  totalCost: (staff: number, fixedOverhead = 2000) => foodTruck.wages(staff) + fixedOverhead,
  sfp: (customers: number, staff: number, hours = 8) => customers / (staff * hours),
  mfp: (revenue: number, totalCost: number) => revenue / totalCost,
};

/** Mangoes EOQ. */
export const mangoes = {
  eoq: (D: number, S: number, H: number) => Math.sqrt(2 * D * S / H),
};

/** Supermarket checkout formulas. */
export const supermarket = {
  capacity: (counters: number, serviceTime: number) => (60 / serviceTime) * counters,
  utilization: (demand: number, capacity: number) => Math.min(demand / capacity * 100, 100),
  throughputTime: (demand: number, counters: number, serviceTime: number) => (serviceTime * demand) / counters,
};

/** Vending machine EOQ. */
export const vending = {
  eoq: (D: number, S: number, H: number) => Math.sqrt(2 * D * S / H),
  rop: (demandPerDay: number, leadTime: number) => demandPerDay * leadTime,
  safetyStock: (maxDemandPerDay: number, avgDemandPerDay: number, leadTime: number) =>
    (maxDemandPerDay - avgDemandPerDay) * leadTime,
};
```

**Step 4: Verify pass**

Run: `npx playwright test tests/helpers/oracles.spec.ts`
Expected: 2 passed.

**Step 5: Commit**

```bash
git add tests/helpers/oracles.ts tests/helpers/oracles.spec.ts
git commit -m "test(helpers): add numerical oracle reference implementations"
```

---

## Phase C — Claims extraction

Each sim gets a claims JSON extracted from (a) the insight panel inside the HTML and (b) the accompanying `.docx` lesson plan. Each task has the same shape; only the content varies.

**Shared schema** (TypeScript type declared once in `tests/helpers/claims.ts`):

```typescript
// tests/helpers/claims.ts
export type ClaimType = 'formula' | 'invariant' | 'literal';

export interface Claim {
  id: string;
  phase?: number;
  source: 'insight' | 'docx';
  statement: string;
  type: ClaimType;
  formula?: string;                 // e.g. "sqrt(2*D*S/H)"
  inputs?: Record<string, number>;
  expected?: number | string;
  tolerance?: number;               // absolute tolerance
  assertion?: string;               // for type 'invariant', a short human-readable description
}

export interface ClaimsFile {
  simulation: string;
  claims: Claim[];
}
```

Create this file first:

### Task 9: Add claims type definitions

**Files:**
- Create: `tests/helpers/claims.ts` (content above)

**Step 1: Write file, verify tsc passes**

Run: `npx tsc --noEmit`
Expected: No output.

**Step 2: Commit**

```bash
git add tests/helpers/claims.ts
git commit -m "test(helpers): add claims schema"
```

---

### Task 10-18: Extract claims per simulation

Repeat this pattern for each of the 9 sims. The **procedure** is identical; the **content** differs per sim. Do them one at a time.

**Procedure:**
1. Open `NN <Sim>/<sim>.html`, locate the `INSIGHTS` / `insights` array in the IIFE. Each item has `question` + `answer`. Scan for numerical statements.
2. Open `NN <Sim>/<lesson-plan>.docx` using the Word MCP tool.
3. Scan the lesson plan for learning objectives and expected outcomes that contain numbers or testable invariants.
4. Write a `tests/claims/NN-<slug>.json` file per the schema.
5. Run `npx tsc --noEmit` to validate JSON structure via `resolveJsonModule`.
6. Commit.

**Expected output (example — `tests/claims/06-mangoes.json`):**

```json
{
  "simulation": "Mangoes",
  "claims": [
    {
      "id": "mangoes-insight-eoq-formula",
      "phase": 1,
      "source": "insight",
      "statement": "EOQ = sqrt(2DS/H). With S=$1000, H=$0.10, EOQ is large.",
      "type": "formula",
      "formula": "sqrt(2*D*S/H)",
      "inputs": { "D": 633, "S": 1000, "H": 0.1 },
      "expected": 3558,
      "tolerance": 50
    },
    {
      "id": "mangoes-phase2-smaller-eoq",
      "phase": 2,
      "source": "insight",
      "statement": "Phase 2 EOQ is dramatically smaller than Phase 1",
      "type": "invariant",
      "assertion": "eoq(D,150,0.7) < eoq(D,1000,0.1) * 0.2"
    }
  ]
}
```

**Commit message pattern:**

```bash
git add tests/claims/NN-<slug>.json
git commit -m "test(claims): extract claims for <Sim Name>"
```

**The nine tasks (in order):**

| Task | Sim | Slug |
|---|---|---|
| 10 | 01 Number Guessing Game | `01-number-guessing.json` |
| 11 | 02 The (Un)Productive Food Truck | `02-food-truck.json` |
| 12 | 03 Littles Coffee Shop | `03-coffee-shop.json` |
| 13 | 04 Supermarket Checkout | `04-supermarket.json` |
| 14 | 05 Vending Machine | `05-vending.json` |
| 15 | 06 Mangoes | `06-mangoes.json` |
| 16 | 07 Supply Chain | `07-supply-chain.json` |
| 17 | 08 Red and Blue Hammers | `08-hammers.json` |
| 18 | 09 Garden Project | `09-garden.json` |

---

## Phase D — Per-sim test specs

Each sim gets a single `NN-<slug>.spec.ts` with four `test.describe` blocks: `smoke`, `invariants`, `oracle`, `claims`.

### Task 19: Food Truck spec (template sim — do this one first)

**Files:**
- Create: `tests/02-food-truck.spec.ts`

**Step 1: Write failing test skeleton**

```typescript
// tests/02-food-truck.spec.ts
import { test, expect } from '@playwright/test';
import { loadSim } from './helpers/simRunner';
import { scanForInvalidValues } from './helpers/domScanners';
import { foodTruck } from './helpers/oracles';
import claims from './claims/02-food-truck.json';

const SIM_PATH = '02 The (Un)Productive Food Truck/food truck sim.html';

async function setStaff(page: any, n: number) {
  await page.locator('#staffCount').evaluate((el: HTMLInputElement, v: number) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
}

async function runDay(page: any) {
  await page.locator('#runDayBtn').click();
  // Give Chart.js + DOM updates a tick
  await page.waitForFunction(() => {
    const el = document.getElementById('dayCounter');
    return el && el.textContent && parseInt(el.textContent, 10) > 0;
  });
}

test.describe('Food Truck — smoke', () => {
  for (const staff of [1, 3, 5, 10]) {
    for (const seed of [1, 42]) {
      test(`staff=${staff} seed=${seed}: 5 days produce no NaN`, async ({ page }) => {
        await loadSim(page, SIM_PATH, { seed });
        await setStaff(page, staff);
        for (let i = 0; i < 5; i++) await runDay(page);
        const issues = await scanForInvalidValues(page);
        expect(issues).toEqual([]);
      });
    }
  }
});

test.describe('Food Truck — invariants', () => {
  test('SFP never exceeds MAX_CUSTOMERS_PER_STAFF_HOUR (12)', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 7 });
    for (const staff of [1, 2, 5, 10]) {
      await setStaff(page, staff);
      await runDay(page);
      const sfp = await page.locator('#sfpValue').textContent();
      expect(parseFloat(sfp!)).toBeLessThanOrEqual(12 + 1e-9);
    }
  });

  test('profit = revenue − totalCosts exactly', async ({ page }) => {
    await loadSim(page, SIM_PATH, { seed: 99 });
    await setStaff(page, 3);
    await runDay(page);
    const rev = parseFloat((await page.locator('#revenue').textContent())!);
    const cost = parseFloat((await page.locator('#totalCosts').textContent())!);
    const profitTxt = (await page.locator('#dailyProfit').textContent())!;
    const profit = parseFloat(profitTxt.replace(/[^0-9.\-]/g, ''));
    expect(profit).toBeCloseTo(rev - cost, 2);
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
});

test.describe('Food Truck — claims', () => {
  for (const c of claims.claims) {
    test(c.id, async ({ page }) => {
      if (c.type === 'formula' && c.formula && c.inputs && c.expected !== undefined) {
        // Evaluate the formula against inputs using a whitelisted evaluator
        const result = evalFormula(c.formula, c.inputs);
        const tol = c.tolerance ?? 0;
        expect(Math.abs(result - (c.expected as number))).toBeLessThanOrEqual(tol);
      } else {
        test.skip(true, `claim type ${c.type} not yet auto-testable`);
      }
    });
  }
});

function evalFormula(formula: string, inputs: Record<string, number>): number {
  // Extremely restricted: only Math.sqrt/exp/abs + arithmetic + named inputs
  const safe = formula.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m) => {
    if (m in inputs) return String(inputs[m]);
    if (m === 'sqrt' || m === 'exp' || m === 'abs' || m === 'min' || m === 'max') return 'Math.' + m;
    throw new Error('Unknown symbol in formula: ' + m);
  });
  // eslint-disable-next-line no-new-func
  return Function('"use strict"; return (' + safe + ');')() as number;
}
```

**Step 2: Run to verify some pass, some fail (NaN currently possible on some combos)**

Run: `npx playwright test tests/02-food-truck.spec.ts`
Expected: All `smoke`, `invariants`, `oracle`, and `claims` tests pass (Food Truck has no known bugs).

**Step 3: If any test fails, investigate and either fix the sim or adjust tolerance.** (No speculative fixes — debug per `superpowers:systematic-debugging`.)

**Step 4: Commit**

```bash
git add tests/02-food-truck.spec.ts
git commit -m "test(food-truck): add smoke/invariants/oracle/claims tests"
```

---

### Task 20-27: Per-sim specs (repeat pattern)

Using Task 19 as template, create each remaining spec. Each follows the same four `describe` blocks with sim-specific selectors and assertions.

| Task | Spec file | Sim path | Key selectors / invariants to encode |
|---|---|---|---|
| 20 | `tests/01-number-guessing.spec.ts` | `01 Number Guessing Game/number guessing game.html` | `#guessCount`, `#rangeIndicator`. Invariant: range always brackets answer. |
| 21 | `tests/03-coffee-shop.spec.ts` | `03 Littles Coffee Shop/Littles Coffee Shop.html` | `#utilisationValue`, `#avgTimeValue`. Invariant: util ∈ [0, 100]. |
| 22 | `tests/04-supermarket.spec.ts` | `04 Supermarket Checkout/Supermarket Checkout.html` | `#capacityDisplay`, `#utilizationDisplay`. Oracle: `capacity = (60/serviceTime)*counters` matches UI. |
| 23 | `tests/05-vending.spec.ts` | `05 Vending Machine/Vending Machine.html` | `#vmCurrentInventory`, `#vmCashOnHand`. Invariant: totalCosts = order + holding + stockout. |
| 24 | `tests/06-mangoes.spec.ts` | `06 Mangoes/Mangoes.html` | `#metricCash`, `#metricRevenue`. Oracle: EOQ formula; claims: 51-unit claim for Vending-style EOQ. |
| 25 | `tests/07-supply-chain.spec.ts` | `07 Supply Chain/Supply Chain.html` | `#diagFactoryEI`, `#metricProfit`. Oracle: reference fulfilment matches UI. **Special regression: loads sim, clicks Next Turn once, asserts `#metricProfit` is `$<number>.<digits>`, not `$NaN`.** |
| 26 | `tests/08-hammers.spec.ts` | `08 Red and Blue Hammers/Red and Blue Hammers.html` | `#cashDisplay`, `#redSatisfaction`. Invariant: satisfaction ∈ [0, 100]; cash = initial + revenue − costs. |
| 27 | `tests/09-garden.spec.ts` | `09 Garden Project/Garden Project.html` | `#gpTotalCost`, `#gpOverallUtil`. Invariant: totalCost = sum of staff costs. |

**For each task, follow steps 1-4 of Task 19:** write test, run, verify/debug, commit.

**Commit message pattern:** `test(<slug>): add smoke/invariants/oracle/claims tests`.

---

### Task 28: Explicit regression test for the Supply Chain NaN bug

**Files:**
- Create: `tests/07-supply-chain.regression.spec.ts`

**Step 1: Write the test that would have caught the bug**

```typescript
// tests/07-supply-chain.regression.spec.ts
import { test, expect } from '@playwright/test';
import { loadSim } from './helpers/simRunner';

const SIM_PATH = '07 Supply Chain/Supply Chain.html';

test('freshly loaded Supply Chain produces a finite profit on first Next Turn', async ({ page }) => {
  // No seed — tests real default state path
  await loadSim(page, SIM_PATH, { clearStorage: true });
  await page.locator('#nextTurnBtn').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('turnCounter');
    return el && el.textContent === '1';
  });
  const profitText = (await page.locator('#metricProfit').textContent()) || '';
  expect(profitText).not.toContain('NaN');
  const num = parseFloat(profitText.replace(/[^0-9.\-]/g, ''));
  expect(Number.isFinite(num)).toBe(true);
});
```

**Step 2: Run, verify pass**

Run: `npx playwright test tests/07-supply-chain.regression.spec.ts`
Expected: PASS (bug is already fixed).

**Step 3: Confidence check — temporarily revert the fix, run, verify fail**

Run the following (do NOT commit the revert):
```bash
git stash
git show e372a05:"07 Supply Chain/Supply Chain.html" > "07 Supply Chain/Supply Chain.html"
npx playwright test tests/07-supply-chain.regression.spec.ts
# Expected: FAIL with "Profit should not contain NaN"
git checkout -- "07 Supply Chain/Supply Chain.html"
git stash pop
```

Verify the regression test catches the bug; restore the fix.

**Step 4: Commit**

```bash
git add tests/07-supply-chain.regression.spec.ts
git commit -m "test(supply-chain): regression test for NaN-on-first-turn bug"
```

---

## Phase E — Polish and CI validation

### Task 29: Add docx-sync check

**Files:**
- Create: `tests/claims/sync.spec.ts`
- Create: `tests/helpers/docxHash.ts`

**Purpose:** If a lesson plan `.docx` is edited, CI should remind the human to review/regenerate the corresponding claims JSON.

**Step 1: Implement helper**

```typescript
// tests/helpers/docxHash.ts
import mammoth from 'mammoth';
import crypto from 'crypto';
import path from 'path';

export async function docxTextHash(relativePath: string): Promise<string> {
  const abs = path.resolve(__dirname, '..', '..', relativePath);
  const { value } = await mammoth.extractRawText({ path: abs });
  // Normalise whitespace so trivial edits don't trigger churn
  const normalised = value.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}
```

**Step 2: Write sync spec**

```typescript
// tests/claims/sync.spec.ts
import { test, expect } from '@playwright/test';
import { docxTextHash } from '../helpers/docxHash';

const MAPPINGS: { slug: string; docx: string; expectedHash: string }[] = [
  // Run once: `npx playwright test --list` then fill in. Or leave as '' and the test reports the hash.
  { slug: '06-mangoes', docx: '06 Mangoes/Lesson Plan Mangoes Inventory Lean Game.docx', expectedHash: '' },
  // ... one per sim
];

for (const m of MAPPINGS) {
  test(`lesson plan hash matches claims for ${m.slug}`, async () => {
    const actual = await docxTextHash(m.docx);
    if (!m.expectedHash) {
      console.log(`[docx-hash] ${m.slug} → ${actual}  (copy into MAPPINGS.expectedHash)`);
      test.skip();
    }
    expect(actual).toBe(m.expectedHash);
  });
}
```

**Step 3: First run — harvest hashes**

Run: `npx playwright test tests/claims/sync.spec.ts --reporter=list`
Expected: `[docx-hash] <slug> → <hash>` lines printed. Copy each hash into the corresponding `expectedHash` in `MAPPINGS`.

**Step 4: Re-run — all should pass**

Run: `npx playwright test tests/claims/sync.spec.ts`
Expected: 9 passed.

**Step 5: Commit**

```bash
git add tests/claims/sync.spec.ts tests/helpers/docxHash.ts
git commit -m "test(claims): lock lesson-plan hashes to flag edits for review"
```

---

### Task 30: Add README test section and badge

**Files:**
- Modify: `README.md`

**Step 1: Add badge at top**

At the top of `README.md`, just below the `# Operations Management Simulations` heading:

```markdown
[![Test](https://github.com/amunozUOW/Operations_Management_Simulations/actions/workflows/test.yml/badge.svg)](https://github.com/amunozUOW/Operations_Management_Simulations/actions/workflows/test.yml)
```

**Step 2: Add a "Testing" section near the bottom**

```markdown
## Testing

This repo includes a Playwright test suite that verifies each simulation's math and pedagogical claims. To run locally:

```
npm ci
npx playwright install chromium
npm test
```

Tests run automatically on every push via GitHub Actions. See `docs/plans/2026-04-23-test-suite-design.md` for the test architecture.
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add CI badge and testing section"
```

---

### Task 31: First CI run

**Step 1: Push branch, open PR (or push to main)**

```bash
git push origin main
```

**Step 2: Watch Actions tab**

Visit: `https://github.com/amunozUOW/Operations_Management_Simulations/actions`
Expected: `Test` workflow starts, downloads Chromium, runs tests, finishes green.

**Step 3: If failures occur, investigate**

- Download the `playwright-report` artifact from the failed run.
- Reproduce locally by running the same subset of tests.
- Apply `superpowers:systematic-debugging`.
- Fix, push, re-run.

**Step 4: No commit needed if CI passes.** If fixes were required, commit and push them.

---

## Verification checklist (end of plan)

- [ ] `npm test` passes locally.
- [ ] GitHub Actions CI shows a green check on `main`.
- [ ] CI badge on README renders green.
- [ ] Reverting the Supply Chain fix causes `07-supply-chain.regression.spec.ts` to fail (confidence check performed in Task 28).
- [ ] All nine `tests/claims/*.json` files exist and every claim is either tested (`formula`) or skipped with a documented reason (`invariant` / `literal`).
- [ ] No test uses `test.only` (CI enforces via `forbidOnly`).
- [ ] `docs/plans/2026-04-23-test-suite-design.md` and `docs/plans/2026-04-23-test-suite.md` are committed.

---

## Skills to invoke during execution

- **superpowers:test-driven-development** — every Task in Phases B, D, E is red-green-refactor.
- **superpowers:systematic-debugging** — when any test fails unexpectedly, do not speculate; trace to root cause.
- **superpowers:verification-before-completion** — before marking the plan complete, all items in the checklist above must be verified empirically, not assumed.

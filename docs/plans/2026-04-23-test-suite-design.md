# Test Suite Design — Operations Management Simulations

**Date:** 2026-04-23
**Status:** Approved, ready for implementation
**Author:** Albert Munoz (with Claude)

## Context

Nine self-contained HTML/JavaScript simulations support a postgraduate operations management curriculum (Munoz & Rook, 2026, *Education Sciences*). Each simulation is a single `.html` file — educators open it directly or embed it in an LMS, with no build step or external tooling. This single-file property is a deliberate pedagogical design choice that any testing approach must preserve.

Currently there is no test suite. A recent NaN bug in `07 Supply Chain/Supply Chain.html` (fresh-load init path skipped `resetPhaseData`, leaving order arrays undefined) shipped to the repository because regressions are caught only by manual exploratory play.

## Goal

Build an automated test suite that:

1. Runs each simulation start-to-finish across reasonable input ranges.
2. Verifies no `NaN`, `undefined`, or missing values are produced.
3. Verifies numerical outputs match the documented operations management formulas.
4. Verifies that specific numerical claims made in the simulations' insight panels and accompanying `.docx` lesson plans actually hold.
5. Runs both locally (`npm test`) and in GitHub Actions CI on every push.

## Non-goals

- Unit testing every internal helper (behavioural tests against the running sim are sufficient).
- Visual regression / screenshot testing.
- Performance benchmarking.
- Testing the pedagogical effectiveness of the sims (scope of the paper, not the code).

## Architecture

**Playwright** (headless Chromium). Each sim HTML is loaded in a real browser context; tests drive the UI via clicks and slider changes, read DOM values, and assert.

Rejected alternatives:
- **jsdom + direct IIFE execution** — requires adding `window.__TEST_HOOKS__` inside every sim's IIFE, polluting the source. jsdom also diverges from real browser behaviour on event loops and localStorage.
- **Extract math into `/lib/*.js` + build step** — breaks the single-file distribution property. Educators cloning the repo would no longer be able to `open 07\ Supply\ Chain/Supply\ Chain.html` directly.

Playwright preserves the single-file property (zero source changes), tests exactly what students see, and pays its overhead only in CI setup.

## Test layers

Tests are organised in four layers, applied to each of the 9 simulations.

### Layer 1 — Smoke

For each sim × phase, sample ~10 representative slider/input combinations (min, max, interior points). Run to completion. After every turn:

- Scan every numeric DOM element for `NaN`, `undefined`, `"Infinity"`, empty-where-expected.
- Assert `localStorage` state is parseable JSON.
- Assert no unhandled console errors or promise rejections.

### Layer 2 — Invariants

Properties that must hold regardless of input. Examples:

| Simulation | Invariants |
|---|---|
| Food Truck | `SFP ≤ 12`; `actualCustomers ≤ min(demand, capacity)`; `profit = revenue − totalCosts`. |
| Mangoes | `cash[t] = cash[t−1] + revenue − totalCost`; `totalCost = orderCost + holdingCost`; `inventoryAfterDemand ≥ 0`. |
| Supermarket | `capacity = (60/serviceTime) × counters`; `utilization = min(demand/capacity × 100, 100)`; penalty only when `throughputTime > 60`. |
| Vending | `totalCosts = orderCosts + holdingCosts + stockoutCosts`; `profit = totalRevenue − totalCosts`. |
| Supply Chain | `eI[t] + eB[t] ≥ 0` conservation; `retailerSales[t] ≤ demand[t]`; `Var(orders) ≥ Var(demand)` in Phases 2/3. |
| Coffee Shop | utilisation ∈ [0, 100]; `avgTime ≥ minServiceTime`. |
| Red/Blue Hammers | `cash = initial + revenue − costs`; inventory ≥ 0; satisfaction ∈ [0, 100]. |
| Garden Project | `totalCost = Σ staff.totalCost`; completed ≤ totalPlots; no negative busy time. |
| Number Guessing | range always brackets the answer until found. |

### Layer 3 — Numerical oracle

Seed `Math.random` to a fixed sequence (via `page.addInitScript`). Recompute expected outputs in the test using the documented formula, assert exact equality (or within a defined tolerance for floating-point).

- Mangoes EOQ = `√(2·D·S/H)` across a grid of (D, S, H).
- Food Truck demand curve = `300·exp(−0.1·|price−12|)·randomFactor`.
- Supermarket capacity and throughput formulas.
- Supply Chain fulfilment: parallel reference implementation in `tests/helpers/oracles.ts`, compared turn-by-turn.
- Vending EOQ, ROP, safety stock.

### Layer 4 — Insight panel and lesson plan claims

Extracted into versioned JSON fixtures under `tests/claims/`. Each claim has a structured form that drives a parametrised test.

## Determinism

Playwright's `page.addInitScript` runs before the sim's IIFE. We inject a seeded `mulberry32` PRNG and replace `Math.random` per test.

Smoke/invariant tests run with multiple seeds (e.g., `[1, 42, 12345]`) × multiple slider combinations. Oracle tests run with a fixed seed and a fixed input schedule.

## .docx lesson plan extraction

Approach: **one-off manual extraction into `tests/claims/NN-*.json`, regenerable on lesson-plan change.**

Rationale:
- Lesson plans are prose with inconsistently formatted claims; regex extraction is brittle.
- JSON fixtures become the reviewable pedagogical contract — anyone editing a lesson plan can check claims still hold.
- Regenerating a claims file is a ~10-minute task when a plan is updated.
- CI can diff raw .docx text against a hash stored in the JSON to flag for review.

Claim schema:

```json
{
  "id": "mangoes-eoq-phase1",
  "phase": 1,
  "statement": "EOQ is large with high ordering cost and low holding cost",
  "type": "formula",                     // "formula" | "invariant" | "literal"
  "formula": "sqrt(2*D*S/H)",
  "inputs": { "D": 633, "S": 1000, "H": 0.1 },
  "expected": 3558,
  "tolerance": 100
}
```

## File structure

```
.github/workflows/test.yml
package.json
playwright.config.ts
tests/
  helpers/
    seed.ts                         # deterministic Math.random
    simRunner.ts                    # load HTML, drive sim
    oracles.ts                      # reference math implementations
    domScanners.ts                  # NaN / undefined detection
  claims/
    01-number-guessing.json
    02-food-truck.json
    03-coffee-shop.json
    04-supermarket.json
    05-vending.json
    06-mangoes.json
    07-supply-chain.json
    08-hammers.json
    09-garden.json
  01-number-guessing.spec.ts
  02-food-truck.spec.ts
  03-coffee-shop.spec.ts
  04-supermarket.spec.ts
  05-vending.spec.ts
  06-mangoes.spec.ts
  07-supply-chain.spec.ts
  08-hammers.spec.ts
  09-garden.spec.ts
docs/plans/
  2026-04-23-test-suite-design.md
```

## CI (`.github/workflows/test.yml`)

Trigger: push, pull_request.

1. `actions/setup-node@v4` (Node 20).
2. `npm ci`.
3. `npx playwright install --with-deps chromium` (with `actions/cache` on `~/.cache/ms-playwright`).
4. `npx playwright test`.
5. `actions/upload-artifact@v4` on failure — uploads the Playwright HTML report.

Expected runtime: ~2 min cold, ~45s with warm cache.

## Success criteria

- `npm test` passes on a clean clone after `npm ci` and `npx playwright install chromium`.
- `npm test` fails and reports the exact NaN location if the pre-fix Supply Chain bug is reintroduced.
- `npm test` fails with a clear message if any insight panel claim drifts (e.g., Mangoes Phase 1 EOQ insight says "≈ 51 units" but the code produces something else).
- GitHub Actions runs on every push and displays a green check or failing report.

## Out of scope for v1

- Cross-browser testing (Firefox, WebKit). Chromium only for v1.
- Mobile viewport testing.
- Mutation testing of the sims' own code.
- Fuzz testing beyond the defined input ranges.

## Implementation plan

To be produced by the `superpowers:writing-plans` skill after this design is approved.

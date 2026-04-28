# Number Guessing Game — UI Cleanup Design

**Date:** 2026-04-28
**Status:** Approved, ready for implementation
**Sim affected:** `01 Number Guessing Game/number guessing game.html`

## Goal

Remove redundant UI from the Number Guessing Game, fix a small UOW-brand consistency issue, and make the disclosure widgets behave correctly. Strictly visual / textual changes — no logic changes.

## Context

User screenshot showed three sources of redundancy:
1. The chart x-axis labels every tick `Guess 1, Guess 2, …` and *also* titles the axis `Guess Number`.
2. The right side of the control bar shows both `Guesses: 9` and a `Range: 96 – 96` pill, while the activity log already conveys both narratives.
3. The `<details>` summary triangles (`▶`) for *How to Play* and *Activity Log* never rotate to indicate expanded state.

The user also asked for "any other ideas to make it more to the point". Four additional changes were proposed and approved.

## Changes

### A. Chart axes — drop the repeated word "Guess"

| | Before | After |
|---|---|---|
| x-axis title | `Guess Number` | `Guesses` |
| x-axis tick labels | `Guess 1, Guess 2, …` | `1, 2, …` |
| y-axis title | `Units Guessed` | `Units` |

Implementation: change the `labels` mapping in `updateChart` from `'Guess ' + (i + 1)` to `(i + 1)`, and update both `scales.x.title.text` and `scales.y.title.text`.

### B. Drop the Range pill

Remove `#ngs-rangeIndicator` and its containing markup from the control bar (around line 72). Remove its updates in `updateRange` (line 162) and `resetGame` (line 225). The internal `knownLow` / `knownHigh` state stays — the test suite reads it via `page.evaluate`, and the input placeholder uses it (see D).

### C. Disclosure triangles rotate when open

Add a small style block:

```css
details > summary > .ngs-disclosure { display: inline-block; transition: transform 0.18s; }
details[open] > summary > .ngs-disclosure { transform: rotate(90deg); }
```

Wrap each triangle span in `class="ngs-disclosure"` and remove the inline `transition: transform 0.2s` attribute.

### D. Move guess count into the Activity Log summary, drop the standalone counter

Activity Log summary becomes `Activity Log (N)` where N is the running guess count. Remove the `Guesses: <strong id="ngs-guessCount">0</strong>` chip from the control bar. Remove the divider span between the two control-bar groups. Update `makeGuess` and `resetGame` to update the new counter element id.

Combined with B, the entire right-hand half of the control bar disappears.

### E. Live placeholder reflects the narrowing range

While playing, the input's `placeholder` updates from `1–200` to `96–96` (or whatever the current `[knownLow, knownHigh]` is). The placeholder text uses an en dash (`–`, U+2013), not a hyphen, to match the prior UI.

Set placeholder in `updateRange` and `resetGame`.

### F. Replace em dashes with colons or sentence breaks

UOW brand rule: no em dashes in UI text. Four instances:

| Where | Before | After |
|---|---|---|
| Scenario brief (line 33) | `zero demand data — all you know is that demand is somewhere between 1 and 200 units` | `zero demand data. All you know is that demand is somewhere between 1 and 200 units` |
| Activity log empty state (line 82) | `No guesses yet — make your first decision above.` | `No guesses yet. Make your first decision above.` |
| First-guess feedback (line 185) | `Your first decision is in — now refine it.` | `Your first decision is in. Now refine it.` |
| First-guess-correct (line 182) | `Unbelievable — you nailed it on your very first guess!` | `Unbelievable! You nailed it on your very first guess!` |

### G. Brand-leftover chart fill colour

Line 240 still has the legacy `rgba(58, 86, 212, 0.1)` (translucent of `#3a56d4`, a pre-UOW brand colour). Update to `rgba(0, 51, 255, 0.1)` (UOW Bright Blue).

### H. (Same as listed C above — rotation. Renumbered here for the design doc only.)

## Test impact

The existing spec `tests/01-number-guessing.spec.ts` interacts with:
- `#ngs-guessInput`, `#ngs-submitBtn`, `#ngs-resetBtn` — unchanged
- `#ngs-rangeIndicator` — **removed**. The spec doesn't read this element directly; range bracketing is verified by re-deriving `[knownLow, knownHigh]` via `page.evaluate`.
- `#ngs-guessCount` — **renamed/relocated** into the Activity Log summary. Need to verify that the spec's "guess count stays at 0" smoke check still passes; if it reads `#ngs-guessCount` we will update the selector.

Plan: read the spec before editing the HTML, anticipate any selector changes, run the spec after the edit.

## Out of scope

- No layout restructuring beyond removing the now-empty right half of the control bar.
- No changes to game logic, scoring, or feedback messages beyond the em-dash replacements.
- No new colour additions; we're only removing one brand-leftover.
- No keyboard shortcut additions or accessibility audit beyond what's already in place.

## Success criteria

- Sim renders correctly when opened directly in a browser.
- All 11 tests in `01-number-guessing.spec.ts` still pass.
- Full suite (229 tests) still green locally and in CI.
- Visually: no `Guess Guess 1` redundancy on the x-axis; no Range pill; triangles rotate; em dashes gone.

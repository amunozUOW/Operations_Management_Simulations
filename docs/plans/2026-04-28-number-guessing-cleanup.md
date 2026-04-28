# Number Guessing Game Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove redundant UI from the Number Guessing Game, fix disclosure-triangle rotation, strip em dashes per UOW brand rules, and tidy a leftover pre-UOW chart fill colour.

**Architecture:** Single sim file (`01 Number Guessing Game/number guessing game.html`). Surgical edits only — no logic changes, no layout restructuring beyond removing the now-empty right half of the control bar. Test spec stays compatible with no changes (range pill not asserted; guess count read via id which we'll preserve in its new location).

**Tech Stack:** Vanilla HTML/CSS, Chart.js v4, Playwright tests.

**Design doc:** `docs/plans/2026-04-28-number-guessing-cleanup-design.md`

**Preconditions:**
- All 229 tests currently green (verified at commit `b6ce7b7`).
- UOW brand application already merged (commit `b6ce7b7`).

---

## Task 1: Verify test spec selectors before editing the sim

**Files (read only):**
- `tests/01-number-guessing.spec.ts`
- `01 Number Guessing Game/number guessing game.html`

**Step 1: Read the spec, list every selector it uses**

Run: `grep -nE "ngs-|getElementById|querySelector" tests/01-number-guessing.spec.ts`

Expected to find at minimum: `#ngs-guessInput`, `#ngs-submitBtn`, `#ngs-resetBtn`, `#ngs-rangeIndicator`, `#ngs-guessCount`, `#ngs-logEntries`, `#ngs-logEmpty`, `#ngs-logDetails`, `#ngs-chart`.

**Step 2: For each selector, decide what happens**

| Selector | Decision |
|---|---|
| `#ngs-guessInput`, `#ngs-submitBtn`, `#ngs-resetBtn`, `#ngs-chart` | Untouched. |
| `#ngs-rangeIndicator` | Removed. Spec must not depend on it (verify via grep). |
| `#ngs-guessCount` | Moved into the Activity Log summary. Keep the same id. |
| `#ngs-logEntries`, `#ngs-logEmpty`, `#ngs-logDetails` | Untouched. |

**Step 3: If `#ngs-rangeIndicator` is referenced, note the test names**

Run: `grep -n "ngs-rangeIndicator" tests/01-number-guessing.spec.ts`

If present, write down which tests reference it. We'll update them in a later task. If not present, the cleanup is even simpler.

**Step 4: No commit (read-only task)**

Just record findings; no changes yet.

---

## Task 2: Remove the Range pill from the control bar

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: Read lines 69-74 of the HTML to confirm current structure**

```html
<div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
    <span style="display: inline-block; width: 1px; height: 24px; background: #CDD6F8;"></span>
    <span style="font-size: 14px; color: #555; white-space: nowrap;">Guesses: <strong id="ngs-guessCount" style="color: #001641; font-size: 16px;">0</strong></span>
    <span id="ngs-rangeIndicator" style="font-size: 14px; background: #fff; padding: 4px 12px; border-radius: 12px; border: 1px solid #CDD6F8; white-space: nowrap;">Range: <strong>1 – 200</strong></span>
</div>
```

**Step 2: Edit — remove the entire right-hand div, the divider span, and the range pill**

The control bar's right-hand `<div>` (lines 69-73) should be removed in its entirety. Reasoning: with the guess counter moving to the Activity Log summary in Task 4, this whole right-hand cluster has no remaining content.

Use the Edit tool to delete the inner `<div>` block exactly:

```
old_string =
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
            <span style="display: inline-block; width: 1px; height: 24px; background: #CDD6F8;"></span>
            <span style="font-size: 14px; color: #555; white-space: nowrap;">Guesses: <strong id="ngs-guessCount" style="color: #001641; font-size: 16px;">0</strong></span>
            <span id="ngs-rangeIndicator" style="font-size: 14px; background: #fff; padding: 4px 12px; border-radius: 12px; border: 1px solid #CDD6F8; white-space: nowrap;">Range: <strong>1 – 200</strong></span>
        </div>
new_string = (empty)
```

**Step 3: Remove `rangeIndicator` updates from JavaScript**

Edit `updateRange` (around line 162) — delete the line:
```javascript
rangeIndicator.innerHTML = 'Range: <strong>' + knownLow + ' – ' + knownHigh + '</strong>';
```

Edit `resetGame` (around line 225) — delete the line:
```javascript
rangeIndicator.innerHTML = 'Range: <strong>1 – 200</strong>';
```

Also delete the `var rangeIndicator = document.getElementById('ngs-rangeIndicator');` line (around line 109).

**Step 4: Quick sanity render — open the sim in a browser**

`open "01 Number Guessing Game/number guessing game.html"`

Expected: Control bar shows just `Your guess: [input] [Submit] [Play Again]`. No right-hand cluster. Sim still runs.

**Step 5: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "refactor(ngg): drop redundant Range pill from control bar"
```

---

## Task 3: Move the guess counter into the Activity Log summary

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: Edit the Activity Log summary**

Around line 78 currently:
```html
<summary style="...; display: flex; align-items: center; gap: 8px;">
    <span style="font-size: 12px;">&#9654;</span> Activity Log
</summary>
```

Change to:
```html
<summary style="...; display: flex; align-items: center; gap: 8px;">
    <span class="ngs-disclosure" style="font-size: 12px;">&#9654;</span> Activity Log <span style="color: #555; font-weight: 400;">(<strong id="ngs-guessCount" style="color: #001641;">0</strong>)</span>
</summary>
```

The `class="ngs-disclosure"` is added now in preparation for Task 5 (rotation). The `#ngs-guessCount` id moves here, so the existing `guessCountEl.textContent = guesses.length;` JS continues to work without change.

**Step 2: Verify the JS still references `ngs-guessCount` and updates it**

Around line 108: `var guessCountEl = document.getElementById('ngs-guessCount');` — unchanged.
Around line 175: `guessCountEl.textContent = guesses.length;` — unchanged.
Around line 224: `guessCountEl.textContent = '0';` — unchanged.

No JS edits needed for this task.

**Step 3: Sanity render**

Open sim. Expected summary text: `▶ Activity Log (0)`. After a guess: `▶ Activity Log (1)`.

**Step 4: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "refactor(ngg): move guess counter into Activity Log summary"
```

---

## Task 4: Add the disclosure-triangle rotation

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: Add a CSS rule for `.ngs-disclosure`**

Insert just before `<div id="number-guess-sim-v1" ...>` (after line 26, the closing `</style>` of the brand-tokens block):

```html
<style>
#number-guess-sim-v1 .ngs-disclosure {
  display: inline-block;
  transition: transform 0.18s ease;
}
#number-guess-sim-v1 details[open] > summary > .ngs-disclosure {
  transform: rotate(90deg);
}
</style>
```

The styles are scoped to `#number-guess-sim-v1` so they don't leak into surrounding LMS chrome.

**Step 2: Add `class="ngs-disclosure"` to the "How to Play" triangle**

Around line 39:
```html
<span style="font-size: 12px; transition: transform 0.2s;">&#9654;</span> How to Play
```

Change to:
```html
<span class="ngs-disclosure" style="font-size: 12px;">&#9654;</span> How to Play
```

(Inline `transition` attribute removed because the new CSS rule covers it.)

**Step 3: Verify the Activity Log triangle already has `class="ngs-disclosure"` from Task 3**

If it doesn't, add it now.

**Step 4: Sanity render**

Open sim. Click "How to Play" — triangle should rotate from ▶ to point downward (90° rotation, which visually looks like ▼ for the unicode glyph). Click again — rotates back. Same for Activity Log.

**Step 5: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "fix(ngg): rotate disclosure triangles when expanded"
```

---

## Task 5: Drop the chart axis word "Guess"

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: Edit the labels mapping in `updateChart`**

Around line 235, change:
```javascript
var labels = guesses.map(function(_, i) { return 'Guess ' + (i + 1); });
```

To:
```javascript
var labels = guesses.map(function(_, i) { return i + 1; });
```

**Step 2: Edit the x-axis title**

Around line 286:
```javascript
title: { display: true, text: 'Guess Number', font: { size: 13, weight: 'bold' }, color: '#555' },
```

Change to:
```javascript
title: { display: true, text: 'Guesses', font: { size: 13, weight: 'bold' }, color: '#555' },
```

**Step 3: Edit the y-axis title**

Around line 291:
```javascript
title: { display: true, text: 'Units Guessed', font: { size: 13, weight: 'bold' }, color: '#555' },
```

Change to:
```javascript
title: { display: true, text: 'Units', font: { size: 13, weight: 'bold' }, color: '#555' },
```

**Step 4: Sanity render**

Open sim. Make 3 guesses. Chart x-axis should show ticks `1 2 3` (no "Guess " prefix) and title `Guesses`. Y-axis title should be `Units`.

**Step 5: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "refactor(ngg): drop redundant 'Guess' from chart axes"
```

---

## Task 6: Live placeholder reflects narrowing range

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: Update `updateRange` to set the placeholder**

Around line 158-163, after the en-dash logic:

```javascript
function updateRange(guess) {
    if (guess < answer && guess >= knownLow) knownLow = guess + 1;
    if (guess > answer && guess <= knownHigh) knownHigh = guess - 1;
    if (guess === answer) { knownLow = answer; knownHigh = answer; }
    // After Task 2: rangeIndicator was removed; placeholder takes over its job.
    guessInput.placeholder = knownLow + '–' + knownHigh;
}
```

The `–` is en dash (matches the original pill's typography).

**Step 2: Update `resetGame` to reset the placeholder**

Around line 225 (after the `rangeIndicator.innerHTML = ...` line was deleted in Task 2), insert:

```javascript
guessInput.placeholder = '1–200';
```

**Step 3: Verify the initial HTML placeholder still says `1–200`**

Around line 56: `placeholder="1–200"` — confirm the en dash is preserved (this character is U+2013).

**Step 4: Sanity render**

Open sim, guess `100` (and assume the answer is e.g. 96 → "lower"). Input placeholder should now read `1–99`. Continue guessing; placeholder narrows.

**Step 5: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "feat(ngg): reflect narrowing range in input placeholder"
```

---

## Task 7: Replace em dashes per UOW brand rules

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: Make four targeted edits**

Use four separate `Edit` calls to keep them auditable.

**Edit 1 — scenario brief (around line 33):**
```
old_string = zero demand data</strong> &mdash; all you know is that demand is somewhere
new_string = zero demand data</strong>. All you know is that demand is somewhere
```
(Note: HTML uses `&mdash;` entity here; check the file for exact form. If it's a literal `—` character, swap that instead.)

**Edit 2 — log empty state (around line 82):**
```
old_string = No guesses yet &mdash; make your first decision above.
new_string = No guesses yet. Make your first decision above.
```

**Edit 3 — first-guess feedback (around line 185):**
```
old_string = Your first decision is in &mdash; now refine it.
new_string = Your first decision is in. Now refine it.
```

**Edit 4 — first-guess-correct (around line 182):**
```
old_string = Unbelievable &mdash; you nailed it on your very first guess!
new_string = Unbelievable! You nailed it on your very first guess!
```

(Replace `&mdash;` with literal `—` if the file uses that form. Read the file first to determine which.)

**Step 2: Verify no remaining em dashes**

Run:
```bash
grep -nE "—|&mdash;" "01 Number Guessing Game/number guessing game.html"
```
Expected: no matches.

**Step 3: Sanity render**

Open sim. Scenario brief reads as two sentences. Log empty state likewise. Make a wrong first guess and a right first guess (use the test seed approach to predict the answer if needed) — confirm both first-guess messages no longer have em dashes.

**Step 4: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "style(ngg): replace em dashes with sentence breaks per UOW brand"
```

---

## Task 8: Fix the leftover pre-UOW chart fill colour

**Files:**
- Modify: `01 Number Guessing Game/number guessing game.html`

**Step 1: One edit**

Around line 240:
```javascript
backgroundColor: 'rgba(58, 86, 212, 0.1)',
```

Change to:
```javascript
backgroundColor: 'rgba(0, 51, 255, 0.1)',
```

**Step 2: Verify no other pre-UOW colour leftovers**

Run:
```bash
grep -nE "58,\s*86,\s*212|3a56d4|0066cc" "01 Number Guessing Game/number guessing game.html"
```
Expected: no matches.

**Step 3: Sanity render — visual only**

The change is to a translucent fill that's barely visible in the line chart anyway. Just confirm the chart still renders.

**Step 4: Commit**

```bash
git add "01 Number Guessing Game/number guessing game.html"
git commit -m "style(ngg): use UOW Bright Blue for chart line fill"
```

---

## Task 9: Run the test suite, fix anything that broke

**Files:**
- Read: `tests/01-number-guessing.spec.ts` (and possibly modify if a selector changed)

**Step 1: Run the Number Guessing spec first**

```bash
npx playwright test tests/01-number-guessing.spec.ts
```

Expected: 11 tests, 8 passing, 3 skipped (the invariant placeholders). Same as before the cleanup.

**Step 2: If anything fails, debug per @superpowers:systematic-debugging**

Most likely failure: a test that reads `#ngs-rangeIndicator` directly. The design says no test does, but verify. If found, the test asserts on the **observable behaviour** (range narrowing), so update the assertion to read `knownLow`/`knownHigh` via `page.evaluate` instead of the (now removed) DOM pill.

**Step 3: Run the full suite**

```bash
npx playwright test
```

Expected: 229 passed, 25 skipped, 0 failed.

**Step 4: If any other sim's test broke**

It shouldn't — only the Number Guessing sim was edited — but verify. If something broke, debug per @superpowers:systematic-debugging.

**Step 5: No commit unless a test was changed**

If we did need to update a test, commit that as a separate logical change:
```bash
git add tests/01-number-guessing.spec.ts
git commit -m "test(ngg): drop reference to removed rangeIndicator element"
```

---

## Task 10: Push and verify CI

**Step 1: Push**

```bash
git push origin main
```

**Step 2: Watch the CI run**

```bash
gh run list --workflow=test.yml --limit 1
gh run watch <run-id> --exit-status
```

Expected: green check.

**Step 3: If CI fails locally-passes**

Download the Playwright report:
```bash
gh run view <run-id> --log
```

Most likely cause if there is one: timing flakiness on slower CI runners. Apply @superpowers:systematic-debugging — don't add retries blindly.

**Step 4: No commit needed if CI passes.**

---

## Verification checklist

- [ ] Open `01 Number Guessing Game/number guessing game.html` in a browser, play through to a correct answer.
- [ ] No `Guess Guess 1` redundancy on x-axis. Title is `Guesses`.
- [ ] Y-axis title is `Units`.
- [ ] No Range pill on the right-hand side. Right-hand cluster of control bar gone entirely.
- [ ] Activity Log summary shows `Activity Log (N)` where N updates.
- [ ] Both disclosure triangles rotate when their section opens.
- [ ] Input placeholder narrows as the range narrows.
- [ ] No em dashes anywhere in scenario brief, log messages, or feedback strings.
- [ ] Chart line fill uses UOW Bright Blue translucency.
- [ ] `npm test` passes locally.
- [ ] CI badge on README is green after push.

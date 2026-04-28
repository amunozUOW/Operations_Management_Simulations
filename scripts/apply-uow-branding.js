#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Applies UOW branding to a simulation HTML file in-place.
 *
 * Strategy (per docs/plans/simulation-design-handoff.md):
 *   - surgical search-and-replace: keep layout/inline styles, only swap colour values
 *   - preserve single-file distribution: no external CSS links
 *   - swap chart.js dataset colours to the UOW chart palette
 *   - inject Montserrat from Google Fonts
 *   - inject a small <style data-uow-tokens> block with :root CSS variables
 *
 * Usage:
 *   node scripts/apply-uow-branding.js path/to/sim.html
 *   node scripts/apply-uow-branding.js  # applies to all 9 sims
 */

const fs = require('fs');
const path = require('path');

// ---------- Colour map (Tailwind-style → UOW) ----------
// Map keys are case-insensitive; longest first to avoid prefix matches.
// Replacement values are the UOW token-equivalent hex.
const COLOUR_MAP = {
  // --- Primary blues (CTAs, headings, dark blue role) ---
  '#1e40af': '#001641',  // blue-800  → UOW Dark Blue
  '#1d4ed8': '#001641',  // blue-700  → UOW Dark Blue
  '#2563eb': '#0033FF',  // blue-600  → UOW Bright Blue (primary CTA)
  '#3b82f6': '#0033FF',  // blue-500  → UOW Bright Blue
  '#1e293b': '#001641',  // slate-800 → UOW Dark Blue (heading text)
  '#1a1a2e': '#001641',
  '#1a1a1a': '#001641',  // near-black body text → UOW Dark Blue
  '#2c44b0': '#001641',
  '#3a56d4': '#0033FF',

  // --- Tints / pale blues ---
  '#dbeafe': '#E3F1F9',  // blue-100 → UOW ice blue
  '#eff6ff': '#E3F1F9',  // blue-50  → UOW ice blue
  '#f0f4ff': '#E3F1F9',
  '#f0f9ff': '#E3F1F9',
  '#f0f7ff': '#E3F1F9',
  '#fcfcfd': '#FFFFFF',
  '#93c5fd': '#0033FF',  // blue-300 (used as accent border) → UOW bright blue
  '#bfdbfe': '#CDD6F8',  // blue-200 → UOW lavender
  '#c7d2f4': '#CDD6F8',
  '#b0bce0': '#CDD6F8',
  '#0284c7': '#0033FF',  // sky-600 → UOW bright blue
  '#0369a1': '#001641',  // sky-700 → UOW dark blue
  '#0277bd': '#001641',  // material blue-800 → UOW dark blue
  '#1a73e8': '#0033FF',  // material blue → UOW bright blue
  '#4682b4': '#0033FF',  // steelblue → UOW bright blue
  '#e1f5fe': '#E3F1F9',  // material light blue → UOW ice blue

  // --- Reds (error / customer / warning) ---
  '#dc2626': '#ED0A00',  // red-600 → UOW red
  '#ef4444': '#ED0A00',  // red-500 → UOW red
  '#b91c1c': '#B00800',  // red-700 → UOW red dark hover
  '#7f1d1d': '#B00800',
  '#991b1b': '#B00800',
  '#fef2f2': '#FBEDED',  // red-50 → UOW error bg
  '#fbeded': '#FBEDED',
  '#fca5a5': '#ED0A00',  // red-300 (used as border) → UOW red
  '#fecaca': '#FBEDED',  // red-200 → error bg

  // --- Oranges / yellows / amber → UOW copper or cream ---
  '#f97316': '#A15A35',  // orange-500 → UOW copper
  '#ea580c': '#A15A35',  // orange-600 → UOW copper
  '#c2410c': '#A15A35',  // orange-700 → UOW copper
  '#fb923c': '#C4744F',  // orange-400 → UOW copper light
  '#fdba74': '#C4744F',  // orange-300 → UOW copper light
  '#fed7aa': '#F0E5D0',  // orange-200 → UOW cream
  '#fff7ed': '#F0E5D0',  // orange-50 → UOW cream
  '#ff9966': '#C4744F',  // custom peach → UOW copper light
  '#ffecb3': '#F0E5D0',
  '#e65100': '#A15A35',  // material deep orange → UOW copper
  '#d97706': '#A15A35',  // amber-600 → UOW copper
  '#92400e': '#A15A35',  // amber-800 → UOW copper
  '#f59e0b': '#A15A35',  // amber-500 → UOW copper
  '#eab308': '#A15A35',  // yellow-500 (used for status warnings) → UOW copper
  '#ca8a04': '#A15A35',  // yellow-600 → UOW copper
  '#fef9c3': '#F0E5D0',  // yellow-100 → UOW cream
  '#fffbeb': '#F0E5D0',  // yellow-50 → UOW cream
  '#fefce8': '#F0E5D0',  // yellow-50 → UOW cream
  '#fcd34d': '#C4744F',  // amber-300 → UOW copper light

  // --- Purples (phase indicators) → re-map to UOW copper for "different phase" feel ---
  '#7c3aed': '#A15A35',  // violet-600 → UOW copper
  '#c084fc': '#C4744F',  // violet-400 → UOW copper light
  '#faf5ff': '#F0E5D0',  // violet-50 → UOW cream
  '#f5f3ff': '#F0E5D0',
  '#5b21b6': '#A15A35',  // violet-800 → UOW copper
  '#9d174d': '#A15A35',  // pink-800 → UOW copper
  '#3730a3': '#001641',  // indigo-800 → UOW dark blue

  // --- Teals (Phase 3 / retailer) → bright blue ---
  '#0d9488': '#0033FF',  // teal-600 → UOW bright blue
  '#0f766e': '#001641',  // teal-700 → UOW dark blue
  '#f0fdfa': '#E3F1F9',  // teal-50 → UOW ice blue
  '#ccfbf1': '#CDD6F8',  // teal-100 → UOW lavender

  // --- Indigo (reservoir / cool accents) ---
  '#4338ca': '#475569',  // indigo-800 → cool grey-700
  '#6366f1': '#64748b',  // indigo-500 → cool grey-500
  '#a5b4fc': '#CDD6F8',  // indigo-300 → UOW lavender
  '#e0e7ff': '#CDD6F8',  // indigo-100 → UOW lavender

  // --- Greens (success) — keep within accessible range, normalise spread ---
  '#22c55e': '#16A34A',  // green-500 → consolidate to green-600
  '#86efac': '#BBF7D0',  // green-300 → green-200
  '#bbf7d0': '#BBF7D0',  // keep
  '#d1fae5': '#F0FDF4',  // emerald-100 → green-50
  '#dcfce7': '#F0FDF4',  // green-100 → green-50
  '#ecfdf5': '#F0FDF4',
  '#15803d': '#1F8A2F',  // green-700 → simulation-styles success
  '#15803D': '#1F8A2F',
  '#166534': '#1F8A2F',
  '#065f46': '#1F8A2F',
  '#059669': '#1F8A2F',  // emerald-600 → simulation-styles success
  '#2e7d32': '#1F8A2F',  // material green-800 → success green
  '#4caf50': '#16A34A',  // material green-500 → green-600
  '#81c784': '#BBF7D0',  // material light green → green-200
};

// ---------- Chart.js palette swap (rgb() in dataset configs) ----------
// Existing patterns: rgb(54,162,235) (blue), rgb(255,159,64) (orange),
// rgb(75,192,192) (teal), rgba(...,0.1) variants for backgrounds.
const CHART_RGB_MAP = [
  // Series 1: Dark Blue (Factory / first dataset)
  ['rgb(54,162,235)', 'rgb(0,22,65)'],            // chart.js default blue → UOW dark
  ['rgba(54,162,235,0.1)', 'rgba(0,22,65,0.12)'],
  // Series 2: Red (often Customer or 2nd dataset)
  ['rgb(255,99,132)', 'rgb(237,10,0)'],            // chart.js red → UOW red
  ['rgba(255,99,132,0.1)', 'rgba(237,10,0,0.12)'],
  // Series 3: Bright Blue (often Retailer/3rd dataset)
  ['rgb(75,192,192)', 'rgb(0,51,255)'],            // chart.js teal → UOW bright blue
  ['rgba(75,192,192,0.1)', 'rgba(0,51,255,0.12)'],
  // Series 4: Copper (often Manufacturer/4th dataset)
  ['rgb(255,159,64)', 'rgb(161,90,53)'],           // chart.js orange → UOW copper
  ['rgba(255,159,64,0.1)', 'rgba(161,90,53,0.12)'],
  // Misc default Chart.js colours
  ['rgb(153,102,255)', 'rgb(161,90,53)'],          // purple → copper
  ['rgba(153,102,255,0.1)', 'rgba(161,90,53,0.12)'],
  ['rgb(255,205,86)', 'rgb(196,116,79)'],          // yellow → copper light
  ['rgba(255,205,86,0.1)', 'rgba(196,116,79,0.12)'],
  // Generic blue used in Chart.js dataset coloring
  ['rgb(37,99,235)', 'rgb(0,51,255)'],             // blue-600 → UOW bright blue
  ['rgba(37,99,235,0.7)', 'rgba(0,51,255,0.7)'],
  ['rgba(37,99,235,0.08)', 'rgba(0,51,255,0.08)'],
  ['rgba(37,99,235,0.1)', 'rgba(0,51,255,0.1)'],
  ['rgba(37,99,235,0.18)', 'rgba(0,51,255,0.18)'],
  ['rgba(0,51,255,0.18)', 'rgba(0,51,255,0.18)'],   // already-converted, idempotent
  ['rgba(251,146,60,0.7)', 'rgba(161,90,53,0.7)'],  // orange-400 bg → copper
  ['rgba(239,68,68,0.7)', 'rgba(237,10,0,0.7)'],    // red-500 → UOW red
  ['rgba(124,58,237,0.1)', 'rgba(161,90,53,0.12)'], // violet-600 → copper
  ['rgba(255,159,64,0.1)', 'rgba(161,90,53,0.12)'],
];

// ---------- Font + tokens injection ----------
const MONTSERRAT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700&display=swap">';

const TOKEN_BLOCK = `<style data-uow-tokens>
:root {
  --uow-white:        #FFFFFF;
  --uow-blue-dark:    #001641;
  --uow-blue-bright:  #0033FF;
  --uow-red:          #ED0A00;
  --uow-grey-light:   #F2F2F2;
  --uow-copper:       #A15A35;
  --uow-copper-light: #C4744F;
  --uow-cream:        #F0E5D0;
  --uow-lavender:     #CDD6F8;
  --uow-ice-blue:     #E3F1F9;
  --uow-font: 'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  --chart-1: #001641;
  --chart-2: #ED0A00;
  --chart-3: #0033FF;
  --chart-4: #A15A35;
  --chart-5: #6B7280;
}
[id^="ops"], [id*="-sim-"], [id*="Sim"], [id$="-sim-v1"], [id$="-sim-v2"] {
  font-family: var(--uow-font) !important;
}
</style>`;

// ---------- Apply ----------
function applyMappings(html) {
  // 1. Hex colour swap (case-insensitive)
  for (const [from, to] of Object.entries(COLOUR_MAP)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    html = html.replace(re, to);
  }
  // 2. Chart.js rgb() / rgba() swap
  for (const [from, to] of CHART_RGB_MAP) {
    // Normalise spaces in source patterns first
    const flexFrom = from.replace(/\s+/g, '\\s*').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\s\*/g, '\\s*');
    // Above ordering is wrong; do it cleaner:
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    html = html.replace(re, to);
  }
  // 3. Inject font and tokens once, immediately after the first existing
  //    <script>, <link>, or <div>. Skip if already injected.
  if (!html.includes('data-uow-tokens')) {
    // Find a sensible insertion point: just before the first <div> tag.
    const insertAt = html.indexOf('<div ');
    if (insertAt !== -1) {
      html = html.slice(0, insertAt) + MONTSERRAT_LINK + '\n' + TOKEN_BLOCK + '\n\n' + html.slice(insertAt);
    }
  }
  return html;
}

// ---------- CLI ----------
function processFile(filePath) {
  const before = fs.readFileSync(filePath, 'utf8');
  const after = applyMappings(before);
  if (before === after) {
    console.log(`= ${filePath} (no changes)`);
    return false;
  }
  fs.writeFileSync(filePath, after);
  // Crude diff stat
  const beforeBytes = Buffer.byteLength(before);
  const afterBytes = Buffer.byteLength(after);
  console.log(`✓ ${filePath} (${beforeBytes} → ${afterBytes} bytes)`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.length === 0) {
    // Default: process all 9 sims
    const repoRoot = path.resolve(__dirname, '..');
    const dirs = fs.readdirSync(repoRoot).filter((d) => /^\d{2} /.test(d));
    files = dirs.map((d) => {
      const sub = fs.readdirSync(path.join(repoRoot, d)).find((f) => f.endsWith('.html'));
      return sub ? path.join(repoRoot, d, sub) : null;
    }).filter(Boolean);
  } else {
    files = args;
  }

  let changed = 0;
  for (const f of files) {
    if (processFile(f)) changed++;
  }
  console.log(`\nDone. ${changed}/${files.length} files modified.`);
}

if (require.main === module) main();

import { test, expect } from '@playwright/test';
import { docxTextHash } from '../helpers/docxHash';

// When a lesson plan is edited, the hash changes and this test fails as a
// prompt for the human maintainer to re-review the corresponding claims JSON.
// Update the hash here once the claims file has been regenerated.
//
// To harvest a new hash: blank the `expected` field and the test prints the
// observed hash and skips itself.

const MAPPINGS: { slug: string; docx: string; expected: string }[] = [
  { slug: '01-number-guessing', docx: '01 Number Guessing Game/Number Guessing game teaching notes.docx',         expected: 'efdc2d0a0bb2c6d8' },
  { slug: '02-food-truck',      docx: '02 The (Un)Productive Food Truck/Food Truck Lesson Plan.docx',              expected: '757ac510c869724d' },
  { slug: '03-coffee-shop',     docx: '03 Littles Coffee Shop/Coffee Shop and sequential littles law.docx',        expected: '8908aac325096acb' },
  { slug: '04-supermarket',     docx: '04 Supermarket Checkout/Supermarket Checkout Lesson Plan.docx',             expected: '2065fb45f4d57065' },
  { slug: '05-vending',         docx: '05 Vending Machine/Vending Machine Inventory Management Lesson Plan.docx', expected: '102162600c6c23bf' },
  { slug: '06-mangoes',         docx: '06 Mangoes/Lesson Plan Mangoes Inventory Lean Game.docx',                   expected: 'c4de87a6ffe36e16' },
  { slug: '07-supply-chain',    docx: '07 Supply Chain/Supply Chain Game Lesson plan.docx',                        expected: '410d95eaf5f3f629' },
  { slug: '08-hammers',         docx: '08 Red and Blue Hammers/Red and Blue Hammers Lesson Plan v2.docx',          expected: 'b8966c5d8c123c1d' },
  { slug: '09-garden',          docx: '09 Garden Project/project management sim doc v2.docx',                       expected: 'a5109cd76b53ff51' },
];

for (const m of MAPPINGS) {
  test(`lesson plan hash matches claims for ${m.slug}`, async () => {
    const actual = await docxTextHash(m.docx);
    if (!m.expected) {
      // eslint-disable-next-line no-console
      console.log(`[docx-hash] ${m.slug} → ${actual}  (copy into MAPPINGS.expected)`);
      test.skip();
    }
    expect(actual, `lesson plan ${m.slug} changed — review ${m.slug}.json claims and update this hash`).toBe(m.expected);
  });
}

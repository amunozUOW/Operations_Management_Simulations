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
  { slug: '02-food-truck',      docx: '02 The (Un)Productive Food Truck/Food Truck Lesson Plan.docx',              expected: '052c9a184787a67b' },
  { slug: '03-coffee-shop',     docx: '03 Littles Coffee Shop/Coffee Shop and sequential littles law.docx',        expected: '14383f51a0f03596' },
  { slug: '04-supermarket',     docx: '04 Supermarket Checkout/Supermarket Checkout Lesson Plan.docx',             expected: '79e11a05ddc276a7' },
  { slug: '05-vending',         docx: '05 Vending Machine/Vending Machine Inventory Management Lesson Plan.docx', expected: '89eab38fc9aa61e1' },
  { slug: '06-mangoes',         docx: '06 Mangoes/Lesson Plan Mangoes Inventory Lean Game.docx',                   expected: '71b246765df79590' },
  { slug: '07-supply-chain',    docx: '07 Supply Chain/Supply Chain Game Lesson plan.docx',                        expected: 'e97484197ae36b85' },
  { slug: '08-hammers',         docx: '08 Red and Blue Hammers/Red and Blue Hammers Lesson Plan v2.docx',          expected: '449a7f47d536151f' },
  { slug: '09-garden',          docx: '09 Garden Project/project management sim doc v2.docx',                       expected: 'a81ee1dcfbad56d9' },
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

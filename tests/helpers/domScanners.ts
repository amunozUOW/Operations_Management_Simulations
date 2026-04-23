import type { Page } from '@playwright/test';

export interface DomIssue {
  selector: string;
  value: string;
}

/**
 * Scan every text node in the page body for invalid values that suggest
 * a math or state bug: literal "NaN", "undefined", or "null" appearing
 * as standalone tokens (not as substrings of ordinary words).
 */
export async function scanForInvalidValues(page: Page): Promise<DomIssue[]> {
  return page.evaluate(() => {
    const issues: { selector: string; value: string }[] = [];
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n: Node): number {
        // Skip text inside script/style/etc. (not user-visible and often contains keywords).
        let p: Node | null = n.parentNode;
        while (p) {
          if (p.nodeType === 1 && SKIP_TAGS.has((p as Element).tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node: Node | null;
    // Match NaN/undefined/null as a whole token (not inside another word).
    const badPattern = /(?:^|[^A-Za-z0-9_])(NaN|undefined|null)(?:$|[^A-Za-z0-9_])/;
    while ((node = walker.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (!txt) continue;
      if (badPattern.test(txt)) {
        const el = (node.parentElement as HTMLElement | null);
        const selector = el
          ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
          : '<text>';
        issues.push({ selector, value: txt });
      }
    }
    return issues;
  });
}

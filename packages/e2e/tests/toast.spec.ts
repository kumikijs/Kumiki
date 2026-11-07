// The runtime's own tests fire the effect on a stub app and mount nothing, and
// do no layout, so a banner that moved under the root or scrolled away with the
// page would pass them. The rest of the banner's behaviour is the example's
// `.browser.json`, which `fixtures.spec.ts` runs.

import { readFileSync } from "node:fs";
import { runOnPage } from "@kumikijs/e2e";
import { feature } from "@kumikijs/examples";
import { expect, test } from "@playwright/test";

const SOURCE = readFileSync(feature("288-toast-in-the-browser"), "utf8");

test("a toast stays in the viewport on a page taller than it", async ({ page }) => {
  // The error toast, which stays: the assertion below retries, and a banner
  // that timed out meanwhile would fail it as missing rather than as misplaced.
  const report = await runOnPage(page, SOURCE, { steps: [{ do: { clickText: "Show error" } }] });
  expect(report.ok).toBe(true);
  // Otherwise the next line holds for a banner placed anywhere in the page.
  expect(await page.evaluate(() => document.body.scrollHeight > window.innerHeight)).toBe(true);
  await expect(page.locator("[data-kumiki-toast]")).toBeInViewport();
});

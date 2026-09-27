// style.md §4.5 in a real viewport: a responsive `cols` map lays the grid out
// in the track count its breakpoint names, and the breakpoints are the active
// theme's. happy-dom has no viewport, so `packages/tests` answers `matchMedia`
// itself; here Chromium does, and the computed track list is what a user sees.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "examples", "features", "158-responsive-breakpoints.kumiki"),
  "utf8",
);

async function mountAt(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  const report = await runOnPage(page, source, {
    steps: [{ label: "mounted", expect: { noErrors: true } }],
  });
  expect(report.ok, JSON.stringify(report.steps)).toBe(true);
}

/** How many column tracks the grid is laid out with. */
const columnCount = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      getComputedStyle(document.querySelector("#tracks") as HTMLElement)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
  );

const gap = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.querySelector("#spaced") as HTMLElement).rowGap);

// Narrow's breakpoints: md 500px, lg 900px, wide 1800px.
for (const [width, cols] of [
  [400, 1],
  [600, 2],
  [1000, 4],
  [1900, 6],
] as const) {
  test(`at ${width}px the grid has ${cols} column(s)`, async ({ page }) => {
    await mountAt(page, width);
    expect(await columnCount(page)).toBe(cols);
  });
}

test("600px is md under a theme that puts md at 500px", async ({ page }) => {
  await mountAt(page, 600);
  expect(await gap(page)).toBe("24px");
});

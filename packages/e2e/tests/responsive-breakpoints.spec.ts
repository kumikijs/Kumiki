import { readFileSync } from "node:fs";
import { runOnPage } from "@kumikijs/e2e";
import { feature } from "@kumikijs/examples";
import { expect, type Page, test } from "@playwright/test";

const source = readFileSync(feature("158-responsive-breakpoints"), "utf8");

/** The same grid and column with no theme, so the default breakpoints apply. */
const NO_THEME = `
tile App = column(
    grid(text("a"), text("b"), text("c"), text("d")) {cols: {base: 1, md: 2, lg: 4}, id: "tracks"},
    column(text("x")) {gap: {base: "sm", md: "lg"}, id: "spaced"})
app Resp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** A theme that writes `md` in rem: 48rem is 768px, wider than sm's 640px. */
const REM_THEME = `
theme T = {
    breakpoints: { md: "48rem" }
}
tile App = column(
    grid(text("a"), text("b"), text("c")) {cols: {base: 1, sm: 2, md: 3}, id: "tracks"})
app Resp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
    theme  = T
`;

async function mountAt(page: Page, width: number, src = source): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  const report = await runOnPage(page, src, {
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

test("a rows map gives an 80px row from lg (900px under Narrow)", async ({ page }) => {
  await mountAt(page, 1000);
  const rows = await page.evaluate(
    () => getComputedStyle(document.querySelector("#tracks") as HTMLElement).gridTemplateRows,
  );
  expect(rows.split(" ")[0]).toBe("80px");
});

test("below md the gap is back to base's 8px", async ({ page }) => {
  await mountAt(page, 400);
  expect(await gap(page)).toBe("8px");
});

for (const [width, cols, g] of [
  [600, 1, "8px"],
  [800, 2, "24px"],
  [1100, 4, "24px"],
] as const) {
  test(`with no theme, ${width}px uses the default breakpoints (${cols} column(s))`, async ({
    page,
  }) => {
    await mountAt(page, width, NO_THEME);
    expect(await columnCount(page)).toBe(cols);
    expect(await gap(page)).toBe(g);
  });
}

test("a rem breakpoint is ordered by its px size and matched as rem", async ({ page }) => {
  await mountAt(page, 800, REM_THEME);
  expect(await columnCount(page)).toBe(3);
  await mountAt(page, 700, REM_THEME);
  expect(await columnCount(page)).toBe(2);
});

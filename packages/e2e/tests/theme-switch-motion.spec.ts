import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const example = readFileSync(
  join(here, "..", "..", "examples", "features", "157-theme-switch.kumiki"),
  "utf8",
);

const source = example
  .replace(
    'slot themeName : Text = "Light"',
    'slot themeName : Text = "Light"\nslot shown : Bool = false\nreducer reveal on=ui.click(RevealBtn) do= shown := true',
  )
  .replace(
    'tile Swatch = box(text("swatch"), Inner) {bg: "surface", color: "fg", pad: "md", gap: "sm", id: "sw"}',
    [
      'tile Swatch = box(text("swatch"), Inner) {bg: "surface", color: "fg", pad: "md", gap: "sm", id: "sw", transition: "fade", transition-duration: "slow"}',
      "motion Rise = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: 5000}",
      'motion Pulse = {keyframes: {from: {opacity: 1}, to: {opacity: 0.5}}, duration: 5000, iteration: "infinite"}',
      'tile Risen = box(text("risen")) {motion: "Rise", id: "risen"}',
      'tile Pulsing = box(text("pulsing")) {motion: "Pulse", id: "pulsing"}',
      'tile Late = box(text("late")) {motion: "Rise", id: "late"}',
      'tile RevealBtn = button(text="Reveal", onClick=reveal)',
    ].join("\n"),
  )
  .replace(
    'tile App    = page(text("theme: " + themeName), ToggleBtn, Swatch)',
    'tile App    = page(text("theme: " + themeName), ToggleBtn, RevealBtn, Swatch, Risen, Pulsing, when(shown, Late()))',
  );

/** The play state of each CSS animation running on `#id`. */
const playStates = (page: Page, id: string): Promise<string[]> =>
  page.evaluate(
    (sel) =>
      document
        .querySelector(sel)
        ?.getAnimations()
        .map((a) => a.playState) ?? [],
    `#${id}`,
  );

test("a theme switch does not replay enter animations, and later renders still animate", async ({
  page,
}) => {
  // Each `replace` above must have landed, or this would test the bare example.
  expect(source).toContain("motion Rise");
  expect(source).toContain('transition: "fade"');
  expect(source).toContain("Pulsing, when(shown, Late())");
  const report = await runOnPage(page, source, {
    steps: [{ label: "mounted under Light", expect: { state: { themeName: "Light" } } }],
  });
  expect(report.ok, JSON.stringify(report.steps)).toBe(true);

  // A fresh mount plays the five-second rise.
  expect(await playStates(page, "risen")).toEqual(["running"]);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByText("theme: Dark")).toBeVisible();
  expect(await playStates(page, "sw")).toEqual(["finished"]);
  expect(await playStates(page, "risen")).toEqual(["finished"]);
  expect(await page.locator("#risen").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  // A repeating animation keeps going rather than stopping at a frame.
  expect(await playStates(page, "pulsing")).toEqual(["running"]);

  await page.getByRole("button", { name: "Reveal" }).click();
  await expect(page.locator("#late")).toBeAttached();
  expect(await playStates(page, "late")).toEqual(["running"]);
});

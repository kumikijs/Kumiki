// Auto-discovered browser-tier fixtures. `.browser.json` files under
// `packages/examples/features/` and `packages/examples/apps/<name>/` are the
// concrete substrate for the tier-3 verification described in
// `docs/spec/testing.md` §8.10. Pairing rule: for a features fixture
// `<X>.browser.json` the source is `<X>.kumiki` in the same directory; for an
// apps fixture any `<any>.browser.json` targets that app's single `app.kumiki`.
// A missing examples directory is treated as a discovery failure — surfaced as
// a spec-level throw so a moved/renamed corpus can't produce a silent green.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage, type Scenario } from "@kumikijs/e2e";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, "..", "..", "examples");

type Fixture = { label: string; source: string; scenario: string };

function featureFixtures(): Fixture[] {
  const dir = join(examplesDir, "features");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".browser.json"))
    .map((f) => {
      const base = f.slice(0, -".browser.json".length);
      return {
        label: `features/${base}`,
        source: join(dir, `${base}.kumiki`),
        scenario: join(dir, f),
      };
    });
}

function appFixtures(): Fixture[] {
  const dir = join(examplesDir, "apps");
  const out: Fixture[] = [];
  for (const name of readdirSync(dir)) {
    const appDir = join(dir, name);
    if (!isDir(appDir)) continue;
    // An app has exactly one `app.kumiki`; any number of scenarios and browser
    // fixtures live beside it and all target that same source.
    const source = join(appDir, "app.kumiki");
    for (const entry of readdirSync(appDir)) {
      if (!entry.endsWith(".browser.json")) continue;
      out.push({
        label: `apps/${name}/${entry}`,
        source,
        scenario: join(appDir, entry),
      });
    }
  }
  return out;
}

// A missing/inaccessible dentry is an expected outcome for both helpers — the
// caller can proceed with an empty list. Any other errno (EACCES, EPERM, IO)
// is a real failure and must propagate, not be silently mistaken for absence.
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

const features = featureFixtures();
const apps = appFixtures();
const fixtures = [...features, ...apps];

test("browser fixtures were discovered", () => {
  // A silent zero-fixture run would mask a broken discovery path or moved
  // examples directory. Requiring at least one per bucket also catches the
  // "features/ still there, apps/ moved" asymmetric drift the mixed-total
  // check would let through.
  expect(features.length, "no features/*.browser.json fixtures were found").toBeGreaterThan(0);
  expect(apps.length, "no apps/**/*.browser.json fixtures were found").toBeGreaterThan(0);
});

for (const fx of fixtures) {
  test(fx.label, async ({ page }) => {
    expect(isFile(fx.source), `missing companion .kumiki for ${fx.label}: ${fx.source}`).toBe(true);
    const source = readFileSync(fx.source, "utf8");
    const scenario = JSON.parse(readFileSync(fx.scenario, "utf8")) as Scenario;
    const report = await runOnPage(page, source, scenario);
    if (!report.ok) {
      const detail = report.steps
        .map((s, i) => {
          const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
          const lines = [head];
          // Without this a step that failed only on `actionError` — the whole
          // reason a fixture's selector drift fails here — prints its heading
          // and nothing under it, on the tier where reproducing locally costs a
          // Chromium install.
          if (s.actionError !== undefined) lines.push(`    action failed: ${s.actionError}`);
          for (const e of s.errors) lines.push(`    error: ${e}`);
          for (const f of s.failures) lines.push(`    assert: ${f}`);
          return lines.join("\n");
        })
        .join("\n");
      throw new Error(`${fx.label} failed browser scenario:\n${detail}`);
    }
  });
}

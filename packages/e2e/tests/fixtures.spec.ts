// Auto-discovered .browser.json fixtures — the concrete tier-3 verification
// (Chromium via Playwright) for the 3-tier verification model in CLAUDE.md.
// Each `*.browser.json` under packages/examples/features/ or
// packages/examples/apps/<name>/ is paired with its sibling `.kumiki` source
// (features/X.browser.json <-> features/X.kumiki;
//  apps/<name>/app.browser.json <-> apps/<name>/app.kumiki) and driven as a
// single Playwright test. Fixture count 0 fails the whole spec — a missing
// fixture directory should not silently produce a green tier-3.

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
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Fixture[] = [];
  for (const name of names) {
    const appDir = join(dir, name);
    if (!isDir(appDir)) continue;
    // An app has exactly one `app.kumiki`; any number of scenarios and browser
    // fixtures live beside it and all target the same source.
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

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

const fixtures = [...featureFixtures(), ...appFixtures()];

test("browser fixtures were discovered", () => {
  // A silent zero-fixture run would mask a broken discovery path or moved
  // examples directory — surface it as a failure instead.
  expect(fixtures.length, "no .browser.json fixtures were found").toBeGreaterThan(0);
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
          for (const e of s.errors) lines.push(`    error: ${e}`);
          for (const f of s.failures) lines.push(`    assert: ${f}`);
          return lines.join("\n");
        })
        .join("\n");
      throw new Error(`${fx.label} failed browser scenario:\n${detail}`);
    }
  });
}

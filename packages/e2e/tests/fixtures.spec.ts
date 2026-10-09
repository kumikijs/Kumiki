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
          if (s.actionError !== undefined) lines.push(`    action failed: ${s.actionError}`);
          if (s.expectedActionError !== undefined) {
            lines.push(`    expected refusal: ${s.expectedActionError}`);
          }
          for (const e of s.errors) lines.push(`    error: ${e}`);
          for (const f of s.failures) lines.push(`    assert: ${f}`);
          return lines.join("\n");
        })
        .join("\n");
      throw new Error(`${fx.label} failed browser scenario:\n${detail}`);
    }
  });
}

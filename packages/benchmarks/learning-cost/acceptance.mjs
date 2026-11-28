// Score each recorded output against its task's acceptance criteria: one scenario per criterion,
// in vN-*/acceptance/, which the model never sees. A criterion passes when its scenario passes
// on a fresh mount; an output that does not build passes none.
//
//   tsx learning-cost/acceptance.mjs [task-dir ...]
//
// Prints a table and writes vN-*/results/acceptance.json.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clearStorage, runScenarioSource } from "@kumikijs/cli";
import { compile } from "../../compiler/src/compile.ts";

const here = dirname(fileURLToPath(import.meta.url));
const VENDORS = ["Claude", "Codex", "Gemini"];

const taskDirs = (
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(here).filter((d) => /^v\d+-/.test(d))
).map((d) => join(here, basename(d)));

const builds = (source) => {
  try {
    return compile(source, { runtimeSpecifier: "./runtime.js" }).kind === "ok";
  } catch {
    return false;
  }
};

for (const task of taskDirs) {
  const acDir = join(task, "acceptance");
  if (!existsSync(acDir)) continue;
  const criteria = readdirSync(acDir)
    .filter((f) => f.endsWith(".scenario.json"))
    .sort()
    .map((f) => ({
      name: f.slice(0, -".scenario.json".length),
      scenario: JSON.parse(readFileSync(join(acDir, f), "utf8")),
    }));
  const result = {};
  for (const vendor of VENDORS) {
    const file = join(task, "results", vendor, "output.kumiki");
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const failed = [];
    if (!builds(source)) {
      failed.push(...criteria.map((c) => c.name));
    } else {
      for (const c of criteria) {
        clearStorage();
        let ok = false;
        try {
          ok = (await runScenarioSource(source, c.scenario)).ok;
        } catch {
          ok = false;
        }
        if (!ok) failed.push(c.name);
      }
    }
    result[vendor] = { passed: criteria.length - failed.length, total: criteria.length, failed };
  }
  writeFileSync(join(task, "results", "acceptance.json"), `${JSON.stringify(result, null, 2)}\n`);
  for (const [vendor, r] of Object.entries(result)) {
    const failedNames = r.failed.length > 0 ? `  failed: ${r.failed.join(", ")}` : "";
    console.log(
      `${basename(task).padEnd(24)} ${vendor.padEnd(7)} ${r.passed}/${r.total}${failedNames}`,
    );
  }
}

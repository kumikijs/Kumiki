// Score each recorded output against its task's acceptance criteria: one scenario per criterion,
// in vN-*/acceptance/, which the model never sees. A criterion passes when its scenario passes
// on a fresh mount; an output that does not build, or a run that wrote none, passes none.
//
//   tsx learning-cost/acceptance.mjs [task-dir ...]
//
// Prints a table and writes vN-*/results/acceptance.json.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clearStorage, runScenarioSource } from "@kumikijs/cli";
import { compile } from "../../compiler/src/compile.ts";

const here = dirname(fileURLToPath(import.meta.url));

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
  // reference/app.kumiki proves the criteria can all be met; it is scored like an output. Each
  // run is a results/ directory: the vendor's name, with -toolchain for a run that had the CLI.
  const resultsDir = join(task, "results");
  const runs = existsSync(resultsDir)
    ? readdirSync(resultsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];
  const outputs = [
    ["Reference", join(task, "reference", "app.kumiki")],
    ...runs.map((r) => [r, join(resultsDir, r, "output.kumiki")]),
  ];
  for (const [vendor, file] of outputs) {
    // A run that wrote nothing scores like one whose program does not build.
    const source = existsSync(file) ? readFileSync(file, "utf8") : null;
    const failed = [];
    if (source === null || !builds(source)) {
      failed.push(...criteria.map((c) => c.name));
    } else {
      for (const c of criteria) {
        // One process runs every criterion, so the storage and the URL the last one left are reset,
        // as a fresh `kumiki run` would start with none and at `/`.
        clearStorage();
        globalThis.history?.replaceState(null, "", "/");
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
  mkdirSync(join(task, "results"), { recursive: true });
  writeFileSync(join(task, "results", "acceptance.json"), `${JSON.stringify(result, null, 2)}\n`);
  for (const [vendor, r] of Object.entries(result)) {
    const failedNames = r.failed.length > 0 ? `  failed: ${r.failed.join(", ")}` : "";
    console.log(
      `${basename(task).padEnd(24)} ${vendor.padEnd(17)} ${r.passed}/${r.total}${failedNames}`,
    );
  }
}

#!/usr/bin/env tsx
// kumiki-e2e <input.kumiki> <scenario.json> [--headed]
// Runs a scenario in a real Chromium and prints the trace.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runScenarioInBrowser, type Scenario } from "./index.ts";

async function main(argv: string[]): Promise<void> {
  const file = argv[2];
  const scenarioPath = argv[3];
  if (!file || !scenarioPath) {
    console.error("Usage: kumiki-e2e <input.kumiki> <scenario.json> [--headed]");
    process.exit(2);
  }
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const scenario = JSON.parse(
    readFileSync(resolve(process.cwd(), scenarioPath), "utf8"),
  ) as Scenario;
  const report = await runScenarioInBrowser(source, scenario, {
    headed: argv.includes("--headed"),
  });

  for (let i = 0; i < report.steps.length; i++) {
    const s = report.steps[i];
    if (!s) continue;
    const status = s.ok ? "ok" : "FAIL";
    const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
    console.log(`[${status}] ${head}`);
    if (s.actionError !== undefined) console.log(`    action failed: ${s.actionError}`);
    for (const e of s.errors) console.log(`    error: ${e}`);
    for (const f of s.failures) console.log(`    assert: ${f}`);
  }
  console.log(report.ok ? "\nbrowser scenario passed" : "\nbrowser scenario FAILED");
  if (!report.ok) process.exit(1);
}

main(process.argv).catch((e) => {
  console.error(String(e));
  process.exit(1);
});

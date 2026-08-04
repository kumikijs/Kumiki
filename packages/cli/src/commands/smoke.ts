import { resolve } from "node:path";
import type { Command } from "commander";
import { smokeCmd } from "../smoke.ts";
import { capsFor } from "./_shared/caps.ts";

const USAGE = "Usage: kumiki smoke <input.kumiki>";

export function registerSmoke(program: Command): void {
  program
    .command("smoke")
    .description("Mount + interact in happy-dom to catch 'compiles but doesn't render'")
    .argument("[input]", "input .kumiki file")
    .option(
      "--diagnostics-as-issues",
      "fail the run on any reconcile diagnostic (rebuilds that lose element identity, props that can never compare equal)",
    )
    .allowExcessArguments(false)
    .action(async (input: string | undefined, opts: { diagnosticsAsIssues?: boolean }) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      const inputPath = resolve(process.cwd(), input);
      await smokeCmd(inputPath, capsFor(inputPath), {
        diagnosticsAsIssues: opts.diagnosticsAsIssues ?? false,
      });
    });
}

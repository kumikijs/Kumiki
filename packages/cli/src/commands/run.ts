import { resolve } from "node:path";
import type { Command } from "commander";
import { runCmd } from "../smoke.ts";
import { capsFor } from "./_shared/caps.ts";
import { exitWithUsage, requireValue } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki run <input.kumiki> <scenario.json> [--episode-log <file>]";

export function registerRun(program: Command): string {
  program
    .command("run")
    .description("Drive a scenario JSON against a compiled app")
    .argument("[input]", "input .kumiki file")
    .argument("[scenario]", "scenario JSON file")
    .option(
      "--episode-log <path>",
      "append committed episodes here (one JSON per line)",
      requireValue(USAGE),
    )
    .allowExcessArguments(false)
    .action(
      async (
        input: string | undefined,
        scenario: string | undefined,
        options: { episodeLog?: string },
      ) => {
        if (!input || !scenario) exitWithUsage(USAGE);
        const inputPath = resolve(process.cwd(), input);
        const runOpts: { episodeLog?: string } = options.episodeLog
          ? { episodeLog: resolve(process.cwd(), options.episodeLog) }
          : {};
        await runCmd(
          inputPath,
          resolve(process.cwd(), scenario),
          capsFor(inputPath).capabilities,
          runOpts,
        );
      },
    );
  return USAGE;
}

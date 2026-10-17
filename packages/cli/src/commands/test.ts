import type { Command } from "commander";
import { testCmd } from "../smoke.ts";
import { capsFor } from "./_shared/caps.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { exitWithUsage } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki test <input.kumiki> [name|prefix*]";

export function registerTest(program: Command): string {
  program
    .command("test")
    .description("Run in-language reducer-test / tile-test / property-test definitions")
    .argument("[input]", "input .kumiki file")
    .argument("[filter]", "test name or name prefix (with trailing *)")
    .option("--coverage", "print per-reducer / effect / tile coverage")
    .option("--watch", "re-run tests on file change")
    .allowExcessArguments(false)
    .action(
      async (
        input: string | undefined,
        filter: string | undefined,
        options: { coverage?: boolean; watch?: boolean },
      ) => {
        if (!input) exitWithUsage(USAGE);
        const inputPath = sourceFileArg(input);
        await testCmd(inputPath, filter, capsFor(inputPath).capabilities, {
          coverage: Boolean(options.coverage),
          watch: Boolean(options.watch),
        });
      },
    );
  return USAGE;
}

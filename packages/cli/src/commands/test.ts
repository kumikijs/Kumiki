import { resolve } from "node:path";
import type { Command } from "commander";
import { testCmd } from "../smoke.ts";
import { capsFor } from "./_shared/caps.ts";

const USAGE = "Usage: kumiki test <input.kumiki> [name|prefix*]";

export function registerTest(program: Command): void {
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
        if (!input) {
          console.error(USAGE);
          process.exit(2);
        }
        const inputPath = resolve(process.cwd(), input);
        await testCmd(inputPath, filter, capsFor(inputPath).capabilities, {
          coverage: Boolean(options.coverage),
          watch: Boolean(options.watch),
        });
      },
    );
}

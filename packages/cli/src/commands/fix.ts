import type { Command } from "commander";
import { fixCmd, fixFromTest } from "../fix.ts";
import { capsFor } from "./_shared/caps.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { exitWithUsage } from "./_shared/usage.ts";

const USAGE =
  "Usage: kumiki fix <file> [--apply] [<code>]\n       kumiki fix <file> --auto-patch <test-name> [--apply]";

export function registerFix(program: Command): string {
  program
    .command("fix")
    .description("Suggest / apply auto-patches for a diagnostic or a failing test")
    .argument("[file]", "input .kumiki file")
    .argument("[code]", "narrow the fix to a single diagnostic code (e.g. E0301)")
    .option("--apply", "write the proposed patch to disk (default is dry-run)")
    .option("--auto-patch <test-name>", "propose a fix that makes <test-name> pass")
    .allowExcessArguments(false)
    .action(
      async (
        file: string | undefined,
        code: string | undefined,
        options: { apply?: boolean; autoPatch?: string },
      ) => {
        if (!file) exitWithUsage(USAGE);
        const apply = Boolean(options.apply);
        const fixPath = sourceFileArg(file);
        if (options.autoPatch !== undefined) {
          const outcome = await fixFromTest(
            fixPath,
            options.autoPatch,
            apply,
            capsFor(fixPath).capabilities,
          );
          const repaired = outcome.status === "already-pass" || (apply && outcome.ok);
          if (!repaired) process.exitCode = 1;
          return;
        }
        process.exitCode = fixCmd(fixPath, apply, code, capsFor(fixPath).capabilities);
      },
    );
  return USAGE;
}

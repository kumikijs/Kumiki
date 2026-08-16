import { resolve } from "node:path";
import type { Command } from "commander";
import { fixCmd, fixFromTest } from "../fix.ts";
import { capsFor } from "./_shared/caps.ts";

const USAGE =
  "Usage: kumiki fix <file> [--apply] [<code>]\n       kumiki fix <file> --auto-patch <test-name> [--apply]";

export function registerFix(program: Command): void {
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
        if (!file) {
          console.error(USAGE);
          process.exit(2);
        }
        const apply = Boolean(options.apply);
        const fixPath = resolve(process.cwd(), file);
        if (options.autoPatch !== undefined) {
          const outcome = await fixFromTest(
            fixPath,
            options.autoPatch,
            apply,
            capsFor(fixPath).capabilities,
          );
          // `ok` counts "a fix is available in dry-run" as success, which is a
          // proposal rather than a repair: the test still fails and the file
          // is untouched. The exit code answers the same question here as it
          // does for the diagnostic path — is the file in the state that was
          // asked for now that the process is ending?
          const repaired = outcome.status === "already-pass" || (apply && outcome.ok);
          if (!repaired) process.exitCode = 1;
          return;
        }
        process.exitCode = fixCmd(fixPath, apply, code, capsFor(fixPath).capabilities);
      },
    );
}

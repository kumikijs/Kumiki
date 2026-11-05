import { resolve } from "node:path";
import type { Command } from "commander";
import { describeEdit, replaceDef } from "../mutate.ts";
import { bodyFileOption, resolveBody } from "./_shared/body-input.ts";
import { WARN_SKIPPED } from "./_shared/op-log.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki replace <file> <qname> <body>";

export function registerReplace(program: Command): string {
  program
    .command("replace")
    .description("Replace an existing definition's body")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name (layer.name)")
    .argument(
      "[body...]",
      "body tokens: a body without a tile's clauses or a type's parameters keeps the definition's, and one starting with `=` drops them (joined by spaces; prefer --body-file for multi-line)",
    )
    .addOption(bodyFileOption(USAGE))
    .allowExcessArguments(false)
    .action(
      async (
        file: string | undefined,
        qname: string | undefined,
        rest: string[],
        options: { bodyFile?: string },
      ) => {
        if (!file || !qname) exitWithUsage(USAGE);
        const body = resolveBody({ positional: rest, bodyFile: options.bodyFile, usage: USAGE });
        printOrExit(() => {
          const result = replaceDef(resolve(process.cwd(), file), qname, body, WARN_SKIPPED);
          return describeEdit({ op: "replace", qname, ...result });
        });
      },
    );
  return USAGE;
}

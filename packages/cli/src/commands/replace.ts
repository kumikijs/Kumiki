import type { Command } from "commander";
import { describeEdit, replaceDef } from "../mutate.ts";
import { resolveBody } from "./_shared/body-input.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { requireValue } from "./_shared/value.ts";

const USAGE = "Usage: kumiki replace <file> <qname> <body>";

export function registerReplace(program: Command): void {
  program
    .command("replace")
    .description("Replace an existing definition's body")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name (layer.name)")
    .argument(
      "[body...]",
      "body tokens: a body without a tile's clauses or a type's parameters keeps the definition's, and one starting with `=` drops them (joined by spaces; prefer --body-file for multi-line)",
    )
    .option(
      "--body-file <path>",
      "read body from a file (use '-' for stdin); preserves whitespace",
      requireValue(USAGE),
    )
    .allowExcessArguments(false)
    .action(
      async (
        file: string | undefined,
        qname: string | undefined,
        rest: string[],
        options: { bodyFile?: string },
      ) => {
        if (!file || !qname) {
          console.error(USAGE);
          process.exit(2);
        }
        const body = resolveBody({ positional: rest, bodyFile: options.bodyFile, usage: USAGE });
        const path = sourceFileArg(file);
        try {
          const result = replaceDef(path, qname, body);
          console.log(describeEdit({ op: "replace", qname, ...result }));
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

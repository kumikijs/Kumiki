import { resolve } from "node:path";
import type { Command } from "commander";
import { replaceDef } from "../mutate.ts";
import { resolveBody } from "./_shared/body-input.ts";

const USAGE = "Usage: kumiki replace <file> <qname> <body>";

export function registerReplace(program: Command): void {
  program
    .command("replace")
    .description("Replace an existing definition's body")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name (layer.name)")
    .argument("[body...]", "body tokens (joined by spaces; prefer --body-file for multi-line)")
    .option("--body-file <path>", "read body from a file (use '-' for stdin); preserves whitespace")
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
        try {
          const opId = replaceDef(resolve(process.cwd(), file), qname, body);
          console.log(`replaced ${qname}  (${opId})`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

import { resolve } from "node:path";
import type { Command } from "commander";
import { addDef } from "../mutate.ts";
import { resolveBody } from "./_shared/body-input.ts";
import { requireValue } from "./_shared/value.ts";

const USAGE = "Usage: kumiki add <file> <layer> <name> <body>";

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Add a new definition to a .kumiki file")
    .argument("[file]", "target .kumiki file")
    .argument("[layer]", "layer name (type/slot/effect/reducer/tile/fn/app)")
    .argument("[name]", "definition name")
    .argument("[body...]", "body tokens (joined by spaces; prefer --body-file for multi-line)")
    .option(
      "--body-file <path>",
      "read body from a file (use '-' for stdin); preserves whitespace",
      requireValue(USAGE),
    )
    .allowExcessArguments(false)
    .action(
      async (
        file: string | undefined,
        layer: string | undefined,
        name: string | undefined,
        rest: string[],
        options: { bodyFile?: string },
      ) => {
        if (!file || !layer || !name) {
          console.error(USAGE);
          process.exit(2);
        }
        const body = resolveBody({ positional: rest, bodyFile: options.bodyFile, usage: USAGE });
        try {
          const opId = addDef(resolve(process.cwd(), file), layer, name, body);
          console.log(`added ${layer}.${name}  (${opId})`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

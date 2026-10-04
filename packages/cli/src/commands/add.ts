import { resolve } from "node:path";
import { Argument, type Command } from "commander";
import { addDef, describeEdit } from "../mutate.ts";
import { LAYERS } from "../store.ts";
import { resolveBody } from "./_shared/body-input.ts";
import { requireValue } from "./_shared/value.ts";

const USAGE = "Usage: kumiki add <file> <layer> <name> <body>";

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Add a new definition to a .kumiki file")
    .argument("[file]", "target .kumiki file")
    // The labels the store puts on definitions, as `list` takes: a kind of
    // definition `list` shows is one `add` writes, and any other word is
    // refused before the file is read.
    .addArgument(new Argument("[layer]", "kind of definition to add").choices([...LAYERS]))
    .argument("[name]", "definition name")
    .argument(
      "[body...]",
      "body tokens: a tile's clauses or a type's parameters, if any, go first (joined by spaces; prefer --body-file for multi-line)",
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
          console.log(describeEdit({ op: "add", qname: `${layer}.${name}`, opId }));
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

import { resolve } from "node:path";
import { Argument, type Command } from "commander";
import { addDef, describeEdit } from "../mutate.ts";
import { LAYERS } from "../store.ts";
import { bodyFileOption, resolveBody } from "./_shared/body-input.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki add <file> <layer> <name> <body>";

export function registerAdd(program: Command): string {
  program
    .command("add")
    .description("Add a new definition to a .kumiki file")
    .argument("[file]", "target .kumiki file")
    .addArgument(new Argument("[layer]", "kind of definition to add").choices([...LAYERS]))
    .argument("[name]", "definition name")
    .argument(
      "[body...]",
      "body tokens: a tile's clauses or a type's parameters, if any, go first (joined by spaces; prefer --body-file for multi-line)",
    )
    .addOption(bodyFileOption(USAGE))
    .allowExcessArguments(false)
    .action(
      async (
        file: string | undefined,
        layer: string | undefined,
        name: string | undefined,
        rest: string[],
        options: { bodyFile?: string },
      ) => {
        if (!file || !layer || !name) exitWithUsage(USAGE);
        const body = resolveBody({ positional: rest, bodyFile: options.bodyFile, usage: USAGE });
        printOrExit(() => {
          const opId = addDef(resolve(process.cwd(), file), layer, name, body);
          return describeEdit({ op: "add", qname: `${layer}.${name}`, opId });
        });
      },
    );
  return USAGE;
}

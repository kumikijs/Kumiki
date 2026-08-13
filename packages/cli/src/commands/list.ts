import { resolve } from "node:path";
import { Argument, type Command } from "commander";
import { LAYERS, listDefs, load } from "../store.ts";

const USAGE = "Usage: kumiki list <input.kumiki> [layer]";

export function listCmd(inputArg: string, layer?: string): void {
  const store = load(resolve(process.cwd(), inputArg));
  const entries = listDefs(store, layer);
  for (const e of entries) {
    console.log(`${e.layer.padEnd(8)} ${e.name}  (${e.range.startLine}-${e.range.endLine})`);
  }
}

export function registerList(program: Command): void {
  program
    .command("list")
    .description("List every definition in a .kumiki file (optionally filtered by layer)")
    .argument("[input]", "input .kumiki file")
    // Validated against the labels the store puts on definitions, so a word
    // that labels nothing is rejected rather than answered with the empty
    // output a real-but-unused label produces. Commander does the check, which
    // also puts the alternatives in `--help` without a second copy of the list.
    .addArgument(new Argument("[layer]", "definition label to filter by").choices([...LAYERS]))
    .allowExcessArguments(false)
    .action((input: string | undefined, layer: string | undefined) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      listCmd(input, layer);
    });
}

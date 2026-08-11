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
    // A layer that is not a layer used to print nothing and exit 0, which is
    // also what a real-but-empty layer prints — so `list app.kumiki tiles`
    // looked like a file with no tiles. Validated by commander against the
    // store's own labels, which puts the alternatives in the error and in
    // `--help` without a second copy of the list.
    .addArgument(new Argument("[layer]", "layer name to filter by").choices([...LAYERS]))
    .allowExcessArguments(false)
    .action((input: string | undefined, layer: string | undefined) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      listCmd(input, layer);
    });
}

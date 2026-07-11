import { resolve } from "node:path";
import type { Command } from "commander";
import { listDefs, load } from "../store.ts";

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
    .argument("[layer]", "layer name to filter by")
    .allowExcessArguments(false)
    .action((input: string | undefined, layer: string | undefined) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      listCmd(input, layer);
    });
}

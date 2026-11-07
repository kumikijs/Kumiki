import { Argument, type Command } from "commander";
import { LAYERS, listDefs, load } from "../store.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { exitWithUsage } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki list <input.kumiki> [layer]";

export function listCmd(inputArg: string, layer?: string): void {
  const store = load(sourceFileArg(inputArg));
  const entries = listDefs(store, layer);
  for (const e of entries) {
    console.log(`${e.layer.padEnd(8)} ${e.name}  (${e.range.startLine}-${e.range.endLine})`);
  }
}

export function registerList(program: Command): string {
  program
    .command("list")
    .description("List every definition in a .kumiki file (optionally filtered by layer)")
    .argument("[input]", "input .kumiki file")
    .addArgument(new Argument("[layer]", "definition label to filter by").choices([...LAYERS]))
    .allowExcessArguments(false)
    .action((input: string | undefined, layer: string | undefined) => {
      if (!input) exitWithUsage(USAGE);
      listCmd(input, layer);
    });
  return USAGE;
}

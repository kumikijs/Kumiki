import { resolve } from "node:path";
import type { Command } from "commander";
import { findReferences, load } from "../store.ts";

const USAGE = "Usage: kumiki refs <input.kumiki> <qname>";

export function refsCmd(inputArg: string, qname: string): void {
  const store = load(resolve(process.cwd(), inputArg));
  const refs = findReferences(store, qname);
  if (refs.length === 0) {
    console.log(`(no references to ${qname})`);
    return;
  }
  for (const r of refs) console.log(`${r.qname}  ${inputArg}:${r.line}`);
}

export function registerRefs(program: Command): void {
  program
    .command("refs")
    .description("Print every definition that references <qname>")
    .argument("[input]", "input .kumiki file")
    .argument("[qname]", "qualified name")
    .allowExcessArguments(false)
    .action((input: string | undefined, qname: string | undefined) => {
      if (!input || !qname) {
        console.error(USAGE);
        process.exit(2);
      }
      refsCmd(input, qname);
    });
}

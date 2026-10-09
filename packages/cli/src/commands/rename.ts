import type { Command } from "commander";
import { describeEdit, renameDef } from "../mutate.ts";
import { sourceFileArg } from "./_shared/source-file.ts";

const USAGE = "Usage: kumiki rename <file> <qname> <new-name>";

export function registerRename(program: Command): void {
  program
    .command("rename")
    .description("Rename a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .argument("[new-name]", "new bare name")
    .allowExcessArguments(false)
    .action((file: string | undefined, qname: string | undefined, newName: string | undefined) => {
      if (!file || !qname || !newName) {
        console.error(USAGE);
        process.exit(2);
      }
      const path = sourceFileArg(file);
      try {
        const opId = renameDef(path, qname, newName);
        console.log(describeEdit({ op: "rename", qname, newName, opId }));
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    });
}

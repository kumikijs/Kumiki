import { resolve } from "node:path";
import type { Command } from "commander";
import { removeDef } from "../mutate.ts";

const USAGE = "Usage: kumiki remove <file> <qname> [--cascade]";

export function registerRemove(program: Command): void {
  program
    .command("remove")
    .description("Remove a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .option("--cascade", "also remove definitions that reference <qname>")
    .allowExcessArguments(false)
    .action(
      (file: string | undefined, qname: string | undefined, options: { cascade?: boolean }) => {
        if (!file || !qname) {
          console.error(USAGE);
          process.exit(2);
        }
        try {
          const opId = removeDef(resolve(process.cwd(), file), qname, Boolean(options.cascade));
          console.log(`removed ${qname}  (${opId})`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

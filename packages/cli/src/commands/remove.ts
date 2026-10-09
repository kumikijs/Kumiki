import { resolve } from "node:path";
import type { Command } from "commander";
import { CASCADE_HELP, describeEdit, removeDef } from "../mutate.ts";

const USAGE = "Usage: kumiki remove <file> <qname> [--cascade]";

export function registerRemove(program: Command): void {
  program
    .command("remove")
    .description("Remove a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .option("--cascade", CASCADE_HELP)
    .allowExcessArguments(false)
    .action(
      (file: string | undefined, qname: string | undefined, options: { cascade?: boolean }) => {
        if (!file || !qname) {
          console.error(USAGE);
          process.exit(2);
        }
        try {
          const result = removeDef(resolve(process.cwd(), file), qname, Boolean(options.cascade));
          console.log(describeEdit({ op: "remove", qname, ...result }));
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { editDef } from "../mutate.ts";

const USAGE = "Usage: kumiki edit <file> <qname> <patch-json>";

/** Load the patch JSON either from a positional token, --patch-file, or stdin. */
function loadPatch(positional: string | undefined, patchFile: string | undefined): unknown {
  if (patchFile !== undefined && positional !== undefined) {
    console.error("--patch-file and positional <patch-json> are mutually exclusive");
    console.error(USAGE);
    process.exit(2);
  }
  if (patchFile !== undefined) {
    const raw = patchFile === "-" ? readFileSync(0, "utf8") : readFileSync(patchFile, "utf8");
    return JSON.parse(raw) as unknown;
  }
  if (positional === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  return JSON.parse(positional) as unknown;
}

export function registerEdit(program: Command): void {
  program
    .command("edit")
    .description("Apply a structured patch to a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .argument("[patch-json]", "inline JSON patch (prefer --patch-file for large patches)")
    .option("--patch-file <path>", "read patch JSON from a file (use '-' for stdin)")
    .allowExcessArguments(false)
    .action(
      (
        file: string | undefined,
        qname: string | undefined,
        patchJson: string | undefined,
        options: { patchFile?: string },
      ) => {
        if (!file || !qname) {
          console.error(USAGE);
          process.exit(2);
        }
        try {
          const patch = loadPatch(patchJson, options.patchFile);
          const opId = editDef(resolve(process.cwd(), file), qname, patch);
          console.log(`edited ${qname}  (${opId})`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { editDef } from "../mutate.ts";
import { requireValue } from "./_shared/value.ts";

const USAGE = "Usage: kumiki edit <file> <qname> <patch-json>";

/** Read a raw patch string from --patch-file (path or '-'), surfacing ENOENT / TTY hangs as exit 2. */
function readPatchFile(source: string): string {
  if (source === "-") {
    if (process.stdin.isTTY) {
      console.error(
        "--patch-file '-' expects piped stdin (pipe data in, or use --patch-file <path>)",
      );
      process.exit(2);
    }
    return readFileSync(0, "utf8");
  }
  try {
    return readFileSync(source, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`--patch-file '${source}': cannot read (${msg})`);
    process.exit(2);
  }
}

/** Load the patch JSON either from a positional token, --patch-file, or stdin. */
function loadPatch(positional: string | undefined, patchFile: string | undefined): unknown {
  if (patchFile !== undefined && positional !== undefined) {
    console.error("--patch-file and positional <patch-json> are mutually exclusive");
    console.error(USAGE);
    process.exit(2);
  }
  if (patchFile !== undefined) {
    const raw = readPatchFile(patchFile);
    try {
      return JSON.parse(raw) as unknown;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`invalid JSON in --patch-file '${patchFile}': ${msg}`);
      process.exit(2);
    }
  }
  if (positional === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    return JSON.parse(positional) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`invalid JSON in <patch-json>: ${msg}`);
    process.exit(2);
  }
}

export function registerEdit(program: Command): void {
  program
    .command("edit")
    .description("Apply a structured patch to a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .argument("[patch-json]", "inline JSON patch (prefer --patch-file for large patches)")
    .option(
      "--patch-file <path>",
      "read patch JSON from a file (use '-' for stdin)",
      requireValue(USAGE),
    )
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
        const patch = loadPatch(patchJson, options.patchFile);
        try {
          const opId = editDef(resolve(process.cwd(), file), qname, patch);
          console.log(`edited ${qname}  (${opId})`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}

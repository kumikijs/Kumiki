import { resolve } from "node:path";
import type { Command } from "commander";
import { describeEdit, editDef } from "../mutate.ts";
import { readInputFile } from "./_shared/body-input.ts";
import { WARN_SKIPPED } from "./_shared/op-log.ts";
import { exitWithUsage, parseJsonOrExit, printOrExit, requireValue } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki edit <file> <qname> <patch-json>";

function loadPatch(positional: string | undefined, patchFile: string | undefined): unknown {
  if (patchFile !== undefined && positional !== undefined) {
    console.error("--patch-file and positional <patch-json> are mutually exclusive");
    exitWithUsage(USAGE);
  }
  if (patchFile !== undefined) {
    return parseJsonOrExit(readInputFile(patchFile, "--patch-file"), `--patch-file '${patchFile}'`);
  }
  if (positional === undefined) exitWithUsage(USAGE);
  return parseJsonOrExit(positional, "<patch-json>");
}

export function registerEdit(program: Command): string {
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
        if (!file || !qname) exitWithUsage(USAGE);
        const patch = loadPatch(patchJson, options.patchFile);
        printOrExit(() =>
          describeEdit({
            op: "edit",
            qname,
            opId: editDef(resolve(process.cwd(), file), qname, patch, WARN_SKIPPED),
          }),
        );
      },
    );
  return USAGE;
}

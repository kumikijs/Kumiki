import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { viewHash, viewHistory } from "../mutate.ts";
import { load, viewDef, viewWithDeps } from "../store.ts";

const USAGE = "Usage: kumiki view <input.kumiki> <qname> [--with-deps|--hash|--history]";

type ViewMode = "text" | "with-deps" | "hash" | "history";

export function viewCmd(inputArg: string, qname: string, mode: ViewMode): void {
  const path = resolve(process.cwd(), inputArg);
  if (mode === "history") {
    // History lives in a sidecar op-log, so this is the one mode that never
    // opens the .kumiki file — and it reported "(no history)" for a path that
    // was never there. Existence is checked rather than parsed on purpose: the
    // history of a file that no longer parses is exactly when it is wanted.
    if (!existsSync(path)) {
      console.error(`File "${path}" not found`);
      process.exit(1);
    }
    const log = viewHistory(path, qname);
    if (log.length === 0) {
      console.log(`(no history for ${qname})`);
      return;
    }
    for (const e of log) {
      console.log(`${e["op-id"]}  ${new Date(e.ts).toISOString()}  ${e.op}  by ${e.author}`);
    }
    return;
  }
  const store = load(path);
  if (mode === "hash") {
    if (!store.byQName.has(qname)) {
      console.error(`Definition "${qname}" not found`);
      process.exit(1);
    }
    console.log(viewHash(store, qname));
    return;
  }
  const out = mode === "with-deps" ? viewWithDeps(store, qname) : viewDef(store, qname);
  if (out === null) {
    console.error(`Definition "${qname}" not found`);
    process.exit(1);
  }
  console.log(out);
}

export function registerView(program: Command): void {
  program
    .command("view")
    .description("Print a definition (optionally with deps, hash, or history)")
    .argument("[input]", "input .kumiki file")
    .argument("[qname]", "qualified name")
    .option("--with-deps", "also print definitions it depends on")
    .option("--hash", "print the content-hash instead of the body")
    .option("--history", "print the op-log history for <qname>")
    .allowExcessArguments(false)
    .action(
      (
        input: string | undefined,
        qname: string | undefined,
        options: { withDeps?: boolean; hash?: boolean; history?: boolean },
      ) => {
        if (!input || !qname) {
          console.error(USAGE);
          process.exit(2);
        }
        const mode: ViewMode = options.history
          ? "history"
          : options.hash
            ? "hash"
            : options.withDeps
              ? "with-deps"
              : "text";
        viewCmd(input, qname, mode);
      },
    );
}

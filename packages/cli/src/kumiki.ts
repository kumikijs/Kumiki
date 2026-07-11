#!/usr/bin/env node
// Thin entry: wire every verb into a commander program and hand off argv.
// Per-verb handlers live in ./commands/<verb>.ts; library-shape functions
// (addDef, smokeFile, ...) still live in the thematic modules re-exported by
// ./index.ts so programmatic consumers (MCP, examples) are unaffected.

import { Command, CommanderError } from "commander";
import { registerAdd } from "./commands/add.ts";
import { registerBuild } from "./commands/build.ts";
import { registerCheck } from "./commands/check.ts";
import { registerDev } from "./commands/dev.ts";
import { registerEdit } from "./commands/edit.ts";
import { registerFix } from "./commands/fix.ts";
import { registerList } from "./commands/list.ts";
import { registerLock } from "./commands/lock.ts";
import { registerPatch } from "./commands/patch.ts";
import { registerRefs } from "./commands/refs.ts";
import { registerRemove } from "./commands/remove.ts";
import { registerRename } from "./commands/rename.ts";
import { registerReplace } from "./commands/replace.ts";
import { registerReplay } from "./commands/replay.ts";
import { registerRun } from "./commands/run.ts";
import { registerSmoke } from "./commands/smoke.ts";
import { registerTest } from "./commands/test.ts";
import { registerUnlock } from "./commands/unlock.ts";
import { registerView } from "./commands/view.ts";

/**
 * Verb → the usage string surfaced when commander itself trips on parsing
 * (missing required option value, excess positionals). Each per-verb command
 * already exits 2 with the same string when its action detects the problem;
 * this map is the fallback for the paths that parsing bails out of before the
 * action ever runs.
 */
const USAGES: Record<string, string> = {
  build: "Usage: kumiki build <input.kumiki> <outdir>",
  list: "Usage: kumiki list <input.kumiki> [layer]",
  view: "Usage: kumiki view <input.kumiki> <qname> [--with-deps|--hash|--history]",
  refs: "Usage: kumiki refs <input.kumiki> <qname>",
  check:
    "Usage: kumiki check <input.kumiki> [--strict-a11y|--strict-icons|--strict-selector-id|--types|--refs|--effects]",
  smoke: "Usage: kumiki smoke <input.kumiki>",
  dev: "Usage: kumiki dev <input.kumiki> [--port <n>] [--episode-log <file>] [--strict-a11y]",
  test: "Usage: kumiki test <input.kumiki> [name|prefix*]",
  run: "Usage: kumiki run <input.kumiki> <scenario.json> [--episode-log <file>]",
  replay:
    "Usage: kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]",
  add: "Usage: kumiki add <file> <layer> <name> <body>",
  replace: "Usage: kumiki replace <file> <qname> <body>",
  remove: "Usage: kumiki remove <file> <qname> [--cascade]",
  rename: "Usage: kumiki rename <file> <qname> <new-name>",
  edit: "Usage: kumiki edit <file> <qname> <patch-json>",
  patch: "Usage: kumiki patch apply <file> <ops.jsonl>\n       kumiki patch revert <file> <op-id>",
  lock: "Usage: kumiki lock <file> <agent-id> <pattern>",
  unlock: "Usage: kumiki unlock <file> <agent-id>",
  fix: "Usage: kumiki fix <file> [--apply] [<code>]\n       kumiki fix <file> --auto-patch <test-name> [--apply]",
};

function usageFor(argv: string[]): string | undefined {
  const verb = argv[2];
  if (verb && USAGES[verb]) return USAGES[verb];
  return undefined;
}

function buildProgram(): Command {
  const program = new Command("kumiki")
    .description("The Kumiki CLI — compiler, runtime driver, and AI-edit toolkit")
    .allowExcessArguments(false)
    .showHelpAfterError(false)
    .showSuggestionAfterError(false)
    .exitOverride();

  registerBuild(program);
  registerList(program);
  registerView(program);
  registerRefs(program);
  registerCheck(program);
  registerSmoke(program);
  registerDev(program);
  registerTest(program);
  registerRun(program);
  registerReplay(program);
  registerAdd(program);
  registerReplace(program);
  registerRemove(program);
  registerRename(program);
  registerEdit(program);
  registerPatch(program);
  registerLock(program);
  registerUnlock(program);
  registerFix(program);

  return program;
}

async function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e instanceof CommanderError) {
      // help / version: commander already printed. Exit with its chosen code.
      if (
        e.code === "commander.help" ||
        e.code === "commander.helpDisplayed" ||
        e.code === "commander.version"
      ) {
        process.exit(e.exitCode ?? 0);
      }
      // Parse failures (missing option arg, unknown option, excess positional)
      // route through the per-verb USAGE so tests that assert on the verb-
      // specific usage string keep passing.
      const usage = usageFor(argv);
      if (e.code === "commander.excessArguments" && argv[2] === "replay") {
        // Preserve the historical wording so `unexpected positional` regex hits.
        console.error("kumiki replay: unexpected positional arguments after <episode-id>");
      } else if (usage) {
        console.error(usage);
      } else {
        console.error(e.message);
      }
      // Commander sends parse failures through exitCode=1 by default
      // (`commander.optionMissingArgument`, `commander.excessArguments`).
      // Tests treat those as "argument shape" errors that deserve exit 2,
      // matching the pre-refactor hand-rolled parser.
      process.exit(2);
    }
    console.error(String(e));
    process.exit(1);
  }
}

main(process.argv).catch((e) => {
  console.error(String(e));
  process.exit(1);
});

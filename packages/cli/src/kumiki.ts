#!/usr/bin/env node

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

const REGISTRARS: ReadonlyArray<readonly [verb: string, register: (program: Command) => string]> = [
  ["build", registerBuild],
  ["list", registerList],
  ["view", registerView],
  ["refs", registerRefs],
  ["check", registerCheck],
  ["smoke", registerSmoke],
  ["dev", registerDev],
  ["test", registerTest],
  ["run", registerRun],
  ["replay", registerReplay],
  ["add", registerAdd],
  ["replace", registerReplace],
  ["remove", registerRemove],
  ["rename", registerRename],
  ["edit", registerEdit],
  ["patch", registerPatch],
  ["lock", registerLock],
  ["unlock", registerUnlock],
  ["fix", registerFix],
];

function buildProgram(): { program: Command; usages: ReadonlyMap<string, string> } {
  const program = new Command("kumiki")
    .description("The Kumiki CLI — compiler, runtime driver, and AI-edit toolkit")
    .allowExcessArguments(false)
    .showHelpAfterError(false)
    .showSuggestionAfterError(false)
    .exitOverride();
  const usages = new Map(REGISTRARS.map(([verb, register]) => [verb, register(program)]));
  return { program, usages };
}

async function main(argv: string[]): Promise<void> {
  const { program, usages } = buildProgram();
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
      if (e.code === "commander.excessArguments" && argv[2] === "replay") {
        console.error("kumiki replay: unexpected positional arguments after <episode-id>");
      } else {
        const usage = argv[2] === undefined ? undefined : usages.get(argv[2]);
        if (usage) console.error(usage);
      }
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

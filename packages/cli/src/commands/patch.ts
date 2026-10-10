import { resolve } from "node:path";
import type { Command } from "commander";
import { patchApplyFile, patchRevert } from "../mutate.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const APPLY_USAGE = "Usage: kumiki patch apply <file> <ops.jsonl>";
const REVERT_USAGE = "Usage: kumiki patch revert <file> <op-id>";
const USAGE =
  "Usage: kumiki patch apply <file> <ops.jsonl>\n       kumiki patch revert <file> <op-id>";

export function registerPatch(program: Command): string {
  const patch = program
    .command("patch")
    .description("Apply or revert batched op-log patches")
    .action(() => exitWithUsage(`${APPLY_USAGE}\n${REVERT_USAGE}`));

  patch
    .command("apply")
    .description("Replay an ops.jsonl file against <file>")
    .argument("[file]", "target .kumiki file")
    .argument("[ops-file]", "ops JSONL file")
    .allowExcessArguments(false)
    .action((file: string | undefined, opsFile: string | undefined) => {
      if (!file || !opsFile) exitWithUsage(APPLY_USAGE);
      printOrExit(() => {
        const ids = patchApplyFile(resolve(process.cwd(), file), resolve(process.cwd(), opsFile));
        return `applied ${ids.length} ops: ${ids.join(", ")}`;
      });
    });

  patch
    .command("revert")
    .description("Revert a previously-applied op by id")
    .argument("[file]", "target .kumiki file")
    .argument("[op-id]", "the op id to revert")
    .allowExcessArguments(false)
    .action((file: string | undefined, opId: string | undefined) => {
      if (!file || !opId) exitWithUsage(REVERT_USAGE);
      printOrExit(() => {
        const newId = patchRevert(resolve(process.cwd(), file), opId);
        return `reverted ${opId}  (${newId})`;
      });
    });
  return USAGE;
}

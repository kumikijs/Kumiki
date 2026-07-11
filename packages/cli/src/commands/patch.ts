import { resolve } from "node:path";
import type { Command } from "commander";
import { patchApplyFile, patchRevert } from "../mutate.ts";

const APPLY_USAGE = "Usage: kumiki patch apply <file> <ops.jsonl>";
const REVERT_USAGE = "Usage: kumiki patch revert <file> <op-id>";

export function registerPatch(program: Command): void {
  const patch = program
    .command("patch")
    .description("Apply or revert batched op-log patches")
    // Bare `kumiki patch` used to fall through to the parser's `default:` usage
    // block (exit 2). Commander's default for a group command is to print help
    // and exit 0, which loses the shape signal. Restore the pre-refactor
    // behavior explicitly.
    .action(() => {
      console.error(APPLY_USAGE);
      console.error(REVERT_USAGE);
      process.exit(2);
    });

  patch
    .command("apply")
    .description("Replay an ops.jsonl file against <file>")
    .argument("[file]", "target .kumiki file")
    .argument("[ops-file]", "ops JSONL file")
    .allowExcessArguments(false)
    .action((file: string | undefined, opsFile: string | undefined) => {
      if (!file || !opsFile) {
        console.error(APPLY_USAGE);
        process.exit(2);
      }
      try {
        const ids = patchApplyFile(resolve(process.cwd(), file), resolve(process.cwd(), opsFile));
        console.log(`applied ${ids.length} ops: ${ids.join(", ")}`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    });

  patch
    .command("revert")
    .description("Revert a previously-applied op by id")
    .argument("[file]", "target .kumiki file")
    .argument("[op-id]", "the op id to revert")
    .allowExcessArguments(false)
    .action((file: string | undefined, opId: string | undefined) => {
      if (!file || !opId) {
        console.error(REVERT_USAGE);
        process.exit(2);
      }
      try {
        const newId = patchRevert(resolve(process.cwd(), file), opId);
        console.log(`reverted ${opId}  (${newId})`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    });
}

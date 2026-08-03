import { resolve } from "node:path";
import type { EpisodeMockPolicy } from "@kumikijs/runtime";
import type { Command } from "commander";
import { parseMockArg, replayCmd } from "../replay.ts";
import { capsFor } from "./_shared/caps.ts";
import { requireValue } from "./_shared/value.ts";

const USAGE =
  "Usage: kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]";

function parseUntilStep(raw: string): number {
  const n = Number(raw);
  // Spec §10.5.3 uses a 1-indexed step counter; `0` has no useful meaning.
  if (!Number.isInteger(n) || n < 1) {
    console.error(`invalid --until-step '${raw}': expected positive integer (1-indexed)`);
    process.exit(2);
  }
  return n;
}

function collectMock(raw: string, prev: string[]): string[] {
  return [...prev, raw];
}

export function registerReplay(program: Command): void {
  program
    .command("replay")
    .description("Replay a recorded episode log against the compiled app (§10.5.3)")
    .argument("[input]", "input .kumiki file")
    .argument("[episode-id]", "optional single episode id to replay")
    .option("--from-log <path>", "JSONL episode log to replay from (required)", requireValue(USAGE))
    .option(
      "--mock <spec>",
      "override an effect: 'name:from-log|ignore|ok(...)|err(...)'",
      collectMock,
      [],
    )
    .option("--until-step <n>", "stop after the Nth reducer step (1-indexed)", parseUntilStep)
    .allowExcessArguments(false)
    .action(
      async (
        input: string | undefined,
        episodeId: string | undefined,
        options: { fromLog?: string; mock: string[]; untilStep?: number },
      ) => {
        if (!input) {
          console.error(USAGE);
          process.exit(2);
        }
        if (!options.fromLog) {
          console.error(USAGE);
          process.exit(2);
        }
        const inputPath = resolve(process.cwd(), input);
        const mocks: Record<string, EpisodeMockPolicy> = {};
        for (const spec of options.mock) {
          try {
            const m = parseMockArg(spec);
            mocks[m.effect] = m.policy;
          } catch (e) {
            console.error((e as Error).message);
            process.exit(2);
          }
        }
        await replayCmd(inputPath, capsFor(inputPath), {
          fromLog: resolve(process.cwd(), options.fromLog),
          ...(episodeId !== undefined ? { episodeId } : {}),
          mocks,
          ...(options.untilStep !== undefined ? { untilStep: options.untilStep } : {}),
        });
      },
    );
}

import { resolve } from "node:path";
import type { Command, OptionValues } from "commander";
import type { DevCmdOptions } from "../dev.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { exitWithUsage, requireValue } from "./_shared/usage.ts";

const USAGE =
  "Usage: kumiki dev <input.kumiki> [--port <n>] [--episode-log <file>] [--strict-a11y]";

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    console.error(`invalid --port '${raw}': expected integer 0..65535`);
    process.exit(2);
  }
  return n;
}

function parseEpisodeLog(raw: string): string {
  return resolve(process.cwd(), requireValue(USAGE)(raw));
}

type DevOptions = OptionValues & {
  port?: number;
  episodeLog?: string;
  strictA11y?: boolean;
};

export function registerDev(program: Command): string {
  program
    .command("dev")
    .description("Run a Vite-backed dev server with HMR + episode/dev panel")
    .argument("[input]", "input .kumiki file")
    .option("--port <n>", "TCP port to bind", parsePort)
    .option("--episode-log <path>", "append committed episodes here", parseEpisodeLog)
    .option("--strict-a11y", "promote a11y warnings to errors")
    .allowExcessArguments(false)
    .action(async (input: string | undefined, options: DevOptions) => {
      if (!input) exitWithUsage(USAGE);
      const inputPath = sourceFileArg(input);
      const devOpts: DevCmdOptions = {
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.episodeLog !== undefined ? { episodeLog: options.episodeLog } : {}),
        ...(options.strictA11y ? { strictA11y: true } : {}),
      };
      const { devCmd } = await import("../dev.ts");
      await devCmd(inputPath, devOpts);
    });
  return USAGE;
}

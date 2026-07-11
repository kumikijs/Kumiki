import { resolve } from "node:path";
import type { Command, OptionValues } from "commander";
import { type DevCmdOptions, devCmd } from "../dev.ts";

const USAGE =
  "Usage: kumiki dev <input.kumiki> [--port <n>] [--episode-log <file>] [--strict-a11y]";

function parsePort(raw: string): number {
  if (raw.startsWith("--")) {
    console.error(`invalid --port '${raw}': expected integer 0..65535`);
    process.exit(2);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    console.error(`invalid --port '${raw}': expected integer 0..65535`);
    process.exit(2);
  }
  return n;
}

function parseEpisodeLog(raw: string): string {
  if (raw.startsWith("--")) {
    console.error(USAGE);
    process.exit(2);
  }
  return resolve(process.cwd(), raw);
}

type DevOptions = OptionValues & {
  port?: number;
  episodeLog?: string;
  strictA11y?: boolean;
};

export function registerDev(program: Command): void {
  program
    .command("dev")
    .description("Run a Vite-backed dev server with HMR + episode/dev panel (§10.7)")
    .argument("[input]", "input .kumiki file")
    .option("--port <n>", "TCP port to bind", parsePort)
    .option("--episode-log <path>", "append committed episodes here", parseEpisodeLog)
    .option("--strict-a11y", "promote a11y warnings to errors")
    .allowExcessArguments(false)
    .action(async (input: string | undefined, options: DevOptions) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      const inputPath = resolve(process.cwd(), input);
      const devOpts: DevCmdOptions = {
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.episodeLog !== undefined ? { episodeLog: options.episodeLog } : {}),
        ...(options.strictA11y ? { strictA11y: true } : {}),
      };
      await devCmd(inputPath, devOpts);
    });
}

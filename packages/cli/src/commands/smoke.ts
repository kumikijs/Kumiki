import { resolve } from "node:path";
import type { Command } from "commander";
import { smokeCmd } from "../smoke.ts";
import { capsFor } from "./_shared/caps.ts";

const USAGE = "Usage: kumiki smoke <input.kumiki>";

export function registerSmoke(program: Command): void {
  program
    .command("smoke")
    .description("Mount + interact in happy-dom to catch 'compiles but doesn't render'")
    .argument("[input]", "input .kumiki file")
    .allowExcessArguments(false)
    .action(async (input: string | undefined) => {
      if (!input) {
        console.error(USAGE);
        process.exit(2);
      }
      const inputPath = resolve(process.cwd(), input);
      await smokeCmd(inputPath, capsFor(inputPath));
    });
}

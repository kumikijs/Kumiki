import type { Command } from "commander";
import { guideListing, readGuide, unknownTopic } from "../guide.ts";

const USAGE = "Usage: kumiki guide [topic]";

export function guideCmd(topic: string | undefined): void {
  if (topic === undefined) {
    process.stdout.write(guideListing());
    return;
  }
  const found = readGuide(topic);
  if (found === null) {
    console.error(`kumiki guide: ${unknownTopic(topic)}`);
    process.exit(2);
  }
  process.stdout.write(found.text);
}

export function registerGuide(program: Command): string {
  program
    .command("guide")
    .description("Print a workflow guide, a diagnostic's entry, or a spec document")
    .argument("[topic]", "author | debug | iterate, a code such as E0201, or a spec document")
    .allowExcessArguments(false)
    .action((topic: string | undefined) => guideCmd(topic));
  return USAGE;
}

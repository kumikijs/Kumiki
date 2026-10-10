import { readFileSync } from "node:fs";
import { Option } from "commander";
import { messageOf } from "../../text.ts";
import { exitWithUsage, requireValue } from "./usage.ts";

export function bodyFileOption(usage: string): Option {
  return new Option(
    "--body-file <path>",
    "read body from a file (use '-' for stdin); preserves whitespace",
  ).argParser(requireValue(usage));
}

type ResolveBodyArgs = {
  positional: string[];
  bodyFile: string | undefined;
  usage: string;
};

export function resolveBody({ positional, bodyFile, usage }: ResolveBodyArgs): string {
  const hasPositional = positional.length > 0;
  if (bodyFile !== undefined && hasPositional) {
    console.error("--body-file and positional body are mutually exclusive");
    exitWithUsage(usage);
  }
  if (bodyFile !== undefined) return readInputFile(bodyFile, "--body-file");
  if (!hasPositional) exitWithUsage(usage);
  return positional.join(" ");
}

/** Reads `source` as the value of `flag`: a path, or `-` for piped stdin. */
export function readInputFile(source: string, flag: string): string {
  if (source === "-") {
    if (process.stdin.isTTY) {
      console.error(`${flag} '-' expects piped stdin (pipe data in, or use ${flag} <path>)`);
      process.exit(2);
    }
    return readFileSync(0, "utf8");
  }
  try {
    return readFileSync(source, "utf8");
  } catch (e) {
    console.error(`${flag} '${source}': cannot read (${messageOf(e)})`);
    process.exit(2);
  }
}

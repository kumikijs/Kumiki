import { readFileSync } from "node:fs";

type ResolveBodyArgs = {
  positional: string[];
  bodyFile: string | undefined;
  usage: string;
  /** Flag name used in error messages ('--body-file', '--patch-file', ...). */
  flag?: string;
};

export function resolveBody({
  positional,
  bodyFile,
  usage,
  flag = "--body-file",
}: ResolveBodyArgs): string {
  const hasPositional = positional.length > 0;
  if (bodyFile !== undefined && hasPositional) {
    console.error(`${flag} and positional body are mutually exclusive`);
    console.error(usage);
    process.exit(2);
  }
  if (bodyFile !== undefined) {
    if (bodyFile === "-") return readStdin(flag);
    return readBodyFile(bodyFile, flag);
  }
  if (!hasPositional) {
    console.error(usage);
    process.exit(2);
  }
  return positional.join(" ");
}

function readStdin(flag: string): string {
  if (process.stdin.isTTY) {
    console.error(`${flag} '-' expects piped stdin (pipe data in, or use ${flag} <path>)`);
    process.exit(2);
  }
  return readFileSync(0, "utf8");
}

function readBodyFile(path: string, flag: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${flag} '${path}': cannot read (${msg})`);
    process.exit(2);
  }
}

import { readFileSync } from "node:fs";

type ResolveBodyArgs = {
  positional: string[];
  bodyFile: string | undefined;
  usage: string;
  /** Flag name used in error messages ('--body-file', '--patch-file', ...). */
  flag?: string;
};

/**
 * Resolve the body of an `add` / `replace` (or JSON of `edit`) invocation.
 *
 * Precedence: `--body-file <path>` wins over positional. A value of `-`
 * reads stdin. Passing both is an error — mixing them would silently drop
 * whichever the CLI decides against.
 *
 * Positional tokens are joined with a single space, matching legacy shell
 * behavior. The join is lossy for multi-space runs; that's exactly why
 * `--body-file` exists.
 *
 * ENOENT / stdin-on-TTY are surfaced as flag-shape errors (exit 2) so they
 * are consistent with commander's own parse-error class rather than falling
 * through to the caller's generic exit 1 catch.
 */
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
  // Reading fd 0 on a TTY blocks forever with no signal to the user. Bail out
  // with an actionable message so `kumiki add ... --body-file -` at a bare
  // prompt fails fast instead of appearing to hang.
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

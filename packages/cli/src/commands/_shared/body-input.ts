import { readFileSync } from "node:fs";

type ResolveBodyArgs = {
  positional: string[];
  bodyFile: string | undefined;
  usage: string;
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
 */
export function resolveBody({ positional, bodyFile, usage }: ResolveBodyArgs): string {
  const hasPositional = positional.length > 0;
  if (bodyFile !== undefined && hasPositional) {
    console.error("--body-file and positional body are mutually exclusive");
    console.error(usage);
    process.exit(2);
  }
  if (bodyFile !== undefined) {
    if (bodyFile === "-") return readFileSync(0, "utf8");
    return readFileSync(bodyFile, "utf8");
  }
  if (!hasPositional) {
    console.error(usage);
    process.exit(2);
  }
  return positional.join(" ");
}

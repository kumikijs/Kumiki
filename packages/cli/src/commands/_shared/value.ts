/**
 * Coercer factory that rejects an option value which looks like another flag.
 *
 * Motivation: with commander alone, `kumiki dev app.kumiki --episode-log --strict-a11y`
 * silently consumes `--strict-a11y` as the log path. The pre-refactor CLI hand-checked
 * this everywhere; commanders' argParser lets us restore the same behavior verb-wide
 * without threading if-branches through each action.
 *
 * `usage` is the exact per-verb USAGE string tests already assert against, so a wrong
 * value produces the same output shape as pre-refactor.
 */
export function requireValue(usage: string): (raw: string) => string {
  return (raw) => {
    if (raw.startsWith("--")) {
      console.error(usage);
      process.exit(2);
    }
    return raw;
  };
}

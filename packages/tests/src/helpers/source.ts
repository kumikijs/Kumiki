/** `defs` followed by an app with no capabilities that serves `root` at every path. */
export function withApp(defs: string, root = "App"): string {
  return `${defs}
app A
    caps   = []
    routes = {"/" -> ${root}, "/404" -> ${root}}
    init   = []
`;
}

/** An edited source, and the 1-based line and column its replacement starts at. */
export type Edited = { source: string; line: number; col: number };

/**
 * `source` with the first `from` after `anchors` replaced by `to`. The first anchor starts a
 * definition (`test inc =`, `tile Go`); each later one is looked for after the one before it, and
 * `from` after the last. Every match stays inside that definition, which ends where the next line
 * starts at column 0, so an edit never lands in a later definition.
 */
export function editedIn(
  source: string,
  anchors: readonly [string, ...string[]],
  from: string,
  to: string,
): Edited {
  const [definition, ...within] = anchors;
  const start = source.indexOf(definition);
  if (start === -1) throw new Error(`the source has no ${definition}`);
  const next = source.slice(start).search(/\n(?=\S)/);
  const end = next === -1 ? source.length : start + next;
  let at = start + definition.length;
  for (const needle of [...within, from]) {
    const hit = source.indexOf(needle, at);
    if (hit === -1 || hit + needle.length > end) {
      throw new Error(`${definition} has no ${needle} there`);
    }
    at = hit + needle.length;
  }
  const hit = at - from.length;
  const edited = source.slice(0, hit) + to + source.slice(at);
  const line = edited.slice(0, hit).split("\n").length;
  return { source: edited, line, col: hit - edited.lastIndexOf("\n", hit - 1) };
}

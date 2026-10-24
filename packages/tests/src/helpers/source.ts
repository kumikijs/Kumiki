/** `defs` followed by an app with no capabilities that serves `root` at every path. */
export function withApp(defs: string, root = "App"): string {
  return `${defs}
app A
    caps   = []
    routes = {"/" -> ${root}, "/404" -> ${root}}
    init   = []
`;
}

/** Where `needle` first occurs in `src`, as the `line:col` a diagnostic or a panic names. */
export function placeOf(src: string, needle: string): string {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`"${needle}" does not occur in the source`);
  const before = src.slice(0, at).split("\n");
  return `${before.length}:${(before[before.length - 1] ?? "").length + 1}`;
}

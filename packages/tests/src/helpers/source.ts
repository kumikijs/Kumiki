/** `defs` followed by an app with no capabilities that serves `root` at every path. */
export function withApp(defs: string, root = "App"): string {
  return `${defs}
app A
    caps   = []
    routes = {"/" -> ${root}, "/404" -> ${root}}
    init   = []
`;
}

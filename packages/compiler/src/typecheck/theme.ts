import type { ThemeDef } from "../ast.ts";
import type { KumikiError } from "./context.ts";

/** The sections whose entries are lengths of 0 or more, each with the message for a negative one. */
const NON_NEGATIVE = new Map<string, (theme: string, key: string, n: number) => string>([
  [
    "spacing",
    (theme, key, n) =>
      `theme "${theme}": spacing "${key}" is ${n}, but a spacing token is 0 or more — pad and gap drop a negative length; write a negative margin in the tile's own style block (see docs/spec/style.md)`,
  ],
  [
    "breakpoints",
    (theme, key, n) =>
      `theme "${theme}": breakpoint "${key}" is ${n}, and a minimum viewport width cannot be negative, so "${key}" is not a breakpoint at all — write a width of 0 or more (see docs/spec/style.md)`,
  ],
]);

/** A negative number written as a spacing token or a breakpoint width (E0239). */
export function checkTheme(def: ThemeDef, errors: KumikiError[]): void {
  for (const { path, value, pos } of def.leaves) {
    const [section, key] = path;
    if (path.length !== 2 || section === undefined || key === undefined) continue;
    if (typeof value !== "number" || value >= 0) continue;
    const describe = NON_NEGATIVE.get(section);
    if (!describe) continue;
    errors.push({
      code: "E0239",
      kind: "negative-theme-length",
      message: describe(def.name, key, value),
      pos,
    });
  }
}

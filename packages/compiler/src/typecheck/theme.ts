import type { ThemeDef } from "../ast.ts";
import type { KumikiError } from "./context.ts";

/** The sections whose entries are lengths of 0 or more, each with what a negative one becomes. */
const NON_NEGATIVE = new Map<string, (theme: string, key: string, n: number) => string>([
  [
    "spacing",
    (theme, key, n) =>
      `theme "${theme}": spacing "${key}" is ${n}, and padding and gap cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)`,
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
    const [section, key, ...deeper] = path;
    if (typeof value !== "number" || value >= 0 || key === undefined || deeper.length > 0) continue;
    const describe = section === undefined ? undefined : NON_NEGATIVE.get(section);
    if (!describe) continue;
    errors.push({
      code: "E0239",
      kind: "negative-theme-length",
      message: describe(def.name, key, value),
      pos,
    });
  }
}

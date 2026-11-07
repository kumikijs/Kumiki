import type { ThemeDef } from "../ast.ts";
import type { KumikiError } from "./context.ts";

/** A section whose entries are lengths of 0 or more: the keys that lead to it, and what a negative one becomes. */
type NonNegativeSection = {
  section: readonly string[];
  describe: (theme: string, key: string, n: number) => string;
};

const NON_NEGATIVE: readonly NonNegativeSection[] = [
  {
    section: ["spacing"],
    describe: (theme, key, n) =>
      `theme "${theme}": spacing "${key}" is ${n}, and padding and gap cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)`,
  },
  {
    section: ["radius"],
    describe: (theme, key, n) =>
      `theme "${theme}": radius "${key}" is ${n}, and a corner radius cannot be negative, so it has no effect — write a length of 0 or more (see docs/spec/style.md)`,
  },
  {
    section: ["typography", "size"],
    describe: (theme, key, n) =>
      `theme "${theme}": typography size "${key}" is ${n}, and a font size cannot be negative, so it has no effect — write a size of 0 or more (see docs/spec/style.md)`,
  },
  {
    section: ["breakpoints"],
    describe: (theme, key, n) =>
      `theme "${theme}": breakpoint "${key}" is ${n}, and a minimum viewport width cannot be negative, so "${key}" is not a breakpoint at all — write a width of 0 or more (see docs/spec/style.md)`,
  },
];

/** The section `path` names an entry of directly, if it is one whose entries are 0 or more. */
function nonNegativeSectionOf(path: readonly string[]): NonNegativeSection | undefined {
  return NON_NEGATIVE.find(
    ({ section }) =>
      path.length === section.length + 1 && section.every((name, i) => path[i] === name),
  );
}

/** A negative number written as a spacing token, a radius, a font size or a breakpoint width (E0239). */
export function checkTheme(def: ThemeDef, errors: KumikiError[]): void {
  for (const { path, value, pos } of def.leaves) {
    if (typeof value !== "number" || value >= 0) continue;
    const rule = nonNegativeSectionOf(path);
    const key = path.at(-1);
    if (!rule || key === undefined) continue;
    errors.push({
      code: "E0239",
      kind: "negative-theme-length",
      message: rule.describe(def.name, key, value),
      pos,
    });
  }
}

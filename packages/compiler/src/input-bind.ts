/** The base types an `input` can bind, each with the field it is read from. */
export type InputBindBase = "Text" | "Int" | "Float" | "Time";

export const TIME_INPUT_PATTERNS: ReadonlyMap<string, string> = new Map([
  ["date", "yyyy-MM-dd"],
  ["datetime-local", "yyyy-MM-ddTHH:mm"],
]);

export const INPUT_BIND_TYPES: Readonly<Record<InputBindBase, readonly string[]>> = {
  Text: [
    "text",
    "email",
    "password",
    "url",
    "search",
    "tel",
    "number",
    "date",
    "datetime-local",
    "time",
    "month",
    "week",
    "color",
  ],
  Int: ["number"],
  Float: ["number"],
  Time: [...TIME_INPUT_PATTERNS.keys()],
};

const BASES = Object.keys(INPUT_BIND_TYPES) as InputBindBase[];

/** `name` as a base an `input` can bind, or `null`. */
export function inputBindBase(name: string): InputBindBase | null {
  return BASES.find((b) => b === name) ?? null;
}

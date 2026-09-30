// Which `input(type=…)` a bound position's type goes with (forms.md §5.1.1),
// and how a `Time` is shown to the field — the answers the checker and the
// lowering share, so the field kinds the checker admits for a `Time` are
// exactly the ones the lowering has a display for.

/** The base types an `input` can bind, each with the field it is read from. */
export type InputBindBase = "Text" | "Int" | "Float" | "Time";

/**
 * How a `Time` is shown to each field kind that can bind one: the text the
 * field takes, on the local clock `Time.parse` reads a zone-less string on.
 */
export const TIME_INPUT_PATTERNS: ReadonlyMap<string, string> = new Map([
  ["date", "yyyy-MM-dd"],
  ["datetime-local", "yyyy-MM-ddTHH:mm"],
]);

/**
 * The `type=` values each base binds with. An omitted `type` is `"text"`, as
 * HTML defaults it. The rows are the §5.1.1 table's. A `Text` is written as
 * typed, so it goes with every field whose value is the text the user edits —
 * a `Text` bound to a date field holds `"2026-03-04"` and shows it back — and
 * only the typed bases are held to the fields their text round-trips through.
 */
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

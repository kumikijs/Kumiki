// The types builtin tile props take (stdlib.md §2.3.11), and the one lookup the
// checker asks them through.
//
// A prop is listed when the spec gives it a type (forms.md §5.2.1 / §5.3) or
// its renderer reads it as one. The renderers convert none of the flags,
// numbers or options: a flag is open, disabled or ticked when it is `true` (or
// truthy), a number is read only when it is one, and a `select` reads `label`
// and `value` off each option. A value of another type is not an error at runtime — it renders
// something else: `open="false"` is a non-empty text and renders the modal
// open, `disabled="true"` is not `true` and leaves the button enabled,
// `level="2"` is no number and renders an `<h1>`, and a `List(Text)` of
// options renders an "undefined" option per entry. So the checker holds the
// value to the type here instead (E0201).
//
// A prop that shows any value as its text (`title`, `summary`) or writes it to
// an attribute (`rows`, `colspan`) is not listed: every value renders as
// written there. The table is published as stdlib.md §2.3.11 on both tracks,
// and `spec-drift.test.ts` compares the two, along with the typed rows of
// forms.md §5.2.1 / §5.3.

/**
 * A prop's type: a primitive the value is checked against as any declared
 * position is, or `Options` — a `select`'s option list, a `List` of records
 * that each carry a `label` and a `value` and may carry more.
 */
export type BuiltinPropType = "Bool" | "Text" | "Float" | "Options";

/** How the spec table and the checker's messages write each type. */
export const PROP_TYPE_SPELLING: Readonly<Record<BuiltinPropType, string>> = {
  Bool: "Bool",
  Text: "Text",
  Float: "Float",
  Options: "List({label, value})",
};

/** How the checker's messages write one entry of `Options`. */
export const OPTION_SPELLING = "{label, value}";

/** One row of the table: each of `props`, on each of `tiles`, takes `type`. */
export type BuiltinPropRow = {
  readonly props: readonly string[];
  readonly type: BuiltinPropType;
  readonly tiles: readonly string[];
};

/**
 * The input elements of stdlib.md §2.3.4, which take the common input props of
 * forms.md §5.3.
 */
export const INPUT_ELEMENTS: readonly string[] = [
  "button",
  "input",
  "textarea",
  "check",
  "radio",
  "select",
  "slider",
  "switch",
  "editable",
];

/** stdlib.md §2.3.11, row for row. */
export const BUILTIN_PROP_ROWS: readonly BuiltinPropRow[] = [
  // forms.md §5.3
  {
    props: ["disabled", "readonly", "required", "auto-focus"],
    type: "Bool",
    tiles: INPUT_ELEMENTS,
  },
  { props: ["placeholder", "auto-complete"], type: "Text", tiles: INPUT_ELEMENTS },
  { props: ["loading"], type: "Bool", tiles: ["button"] },
  { props: ["multiple"], type: "Bool", tiles: ["input"] },
  // The one-way counterparts of `bind=` (forms.md §5.1.1), read as the
  // selection when no `bind=` is written.
  { props: ["value"], type: "Bool", tiles: ["check", "switch"] },
  { props: ["selected"], type: "Bool", tiles: ["radio"] },
  { props: ["options"], type: "Options", tiles: ["select"] },
  { props: ["value", "min", "max", "step"], type: "Float", tiles: ["slider"] },
  // forms.md §5.2.1
  { props: ["auto-complete", "novalidate"], type: "Bool", tiles: ["form"] },
  { props: ["level"], type: "Float", tiles: ["heading"] },
  { props: ["external"], type: "Bool", tiles: ["link"] },
  { props: ["controls", "autoplay"], type: "Bool", tiles: ["video"] },
  { props: ["ordered"], type: "Bool", tiles: ["list"] },
  { props: ["open"], type: "Bool", tiles: ["modal", "drawer", "popover", "details"] },
  { props: ["value", "max"], type: "Float", tiles: ["progress"] },
];

const BY_TILE: ReadonlyMap<string, ReadonlyMap<string, BuiltinPropType>> = (() => {
  const out = new Map<string, Map<string, BuiltinPropType>>();
  for (const row of BUILTIN_PROP_ROWS) {
    for (const tile of row.tiles) {
      const props = out.get(tile) ?? new Map<string, BuiltinPropType>();
      for (const prop of row.props) props.set(prop, row.type);
      out.set(tile, props);
    }
  }
  return out;
})();

/**
 * The type `prop` takes on the builtin `tile`, or `undefined` when the table
 * gives it none — including on every user tile, whose props reach the node
 * its body renders rather than a renderer of their own.
 */
export function builtinPropType(tile: string, prop: string): BuiltinPropType | undefined {
  return BY_TILE.get(tile)?.get(prop);
}

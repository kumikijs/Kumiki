// The renderers convert none of these props: `open="false"` is a non-empty text and renders the
// modal open, `disabled="true"` leaves the button enabled, and a `List(Text)` of options renders an
// "undefined" option per entry. So the checker holds each value to its type (E0201). The table is
// published in stdlib.md.

/** `Options` is a `select`'s option list: records with a `label` and a `value`, and maybe more. */
export type BuiltinPropType = "Bool" | "Text" | "Float" | "Options";

export const PROP_TYPE_SPELLING: Readonly<Record<BuiltinPropType, string>> = {
  Bool: "Bool",
  Text: "Text",
  Float: "Float",
  Options: "List({label, value})",
};

export const OPTION_SPELLING = "{label, value}";

export type BuiltinPropRow = {
  readonly props: readonly string[];
  readonly type: BuiltinPropType;
  readonly tiles: readonly string[];
};

const INPUT_ELEMENTS: readonly string[] = [
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

export const BUILTIN_PROP_ROWS: readonly BuiltinPropRow[] = [
  {
    props: ["disabled", "readonly", "required", "auto-focus"],
    type: "Bool",
    tiles: INPUT_ELEMENTS,
  },
  { props: ["placeholder", "auto-complete"], type: "Text", tiles: INPUT_ELEMENTS },
  { props: ["loading"], type: "Bool", tiles: ["button"] },
  { props: ["multiple"], type: "Bool", tiles: ["input"] },
  // The one-way counterparts of `bind=`, read as the selection when no `bind=` is written.
  { props: ["value"], type: "Bool", tiles: ["check", "switch"] },
  { props: ["selected"], type: "Bool", tiles: ["radio"] },
  { props: ["options"], type: "Options", tiles: ["select"] },
  { props: ["value", "min", "max", "step"], type: "Float", tiles: ["slider"] },
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

export function builtinPropType(tile: string, prop: string): BuiltinPropType | undefined {
  return BY_TILE.get(tile)?.get(prop);
}

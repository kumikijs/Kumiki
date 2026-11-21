/** A kind of `Map` key, as a program writes one. */
export type MapKey = {
  kind: string;
  /** The definitions the key type needs, if any. */
  decl: string;
  /** The key type. */
  type: string;
  /** A key as a Map literal's entry writes it. */
  entry: string;
  /** The same key as an index writes it; a record's index lists its fields in another order. */
  index: string;
  /** The text the runtime stores that entry under. */
  stored: string;
  /** Another key of the same type. */
  other: string;
};

export const MAP_KEYS: readonly MapKey[] = [
  { kind: "Text", decl: "", type: "Text", entry: `"r"`, index: `"r"`, stored: "r", other: `"s"` },
  { kind: "Int", decl: "", type: "Int", entry: "4", index: "4", stored: "4", other: "5" },
  {
    kind: "Bool",
    decl: "",
    type: "Bool",
    entry: "true",
    index: "true",
    stored: "true",
    other: "false",
  },
  {
    kind: "a record",
    decl: "type Pt = {x: Int, y: Int}",
    type: "Pt",
    entry: "{x: 0, y: 1}",
    index: "{y: 1, x: 0}",
    stored: '{"x":0,"y":1}',
    other: "{x: 1, y: 0}",
  },
  {
    kind: "a tuple",
    decl: "",
    type: "Tuple(Int, Int)",
    entry: "(0, 1)",
    index: "(0, 1)",
    stored: "[0,1]",
    other: "(1, 0)",
  },
  {
    kind: "a union",
    decl: "type Shade = Plain | Tint(Int)",
    type: "Shade",
    entry: "Plain",
    index: "Plain",
    stored: '{"_tag":"Plain"}',
    other: "Tint(1)",
  },
  {
    kind: "an Option",
    decl: "",
    type: "Option(Int)",
    entry: "None",
    index: "None",
    stored: '{"_tag":"None"}',
    other: "Some(1)",
  },
];

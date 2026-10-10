import type { Expr, TileExpr, UiEventKind } from "./ast.ts";

export type UiLift = {
  readonly ev: UiEventKind;
  readonly handler: string;
  readonly tiles: ReadonlySet<string> | null;
  // A kind left out of `tiles` although its element fires `ev`, mapped to what
  // its renderer does with the event instead of calling `handler`.
  readonly firesUnheard?: Readonly<Record<string, string>>;
};

const FOCUSABLE_ROOT = [
  "input",
  "textarea",
  "button",
  "select",
  "slider",
  "editable",
  "link",
] as const;

const LABEL_WRAPPED_CONTROL = ["check", "radio", "switch"] as const;

// The events the runtime listens for on the element a renderer returned, and
// whether each bubbles from a label-wrapped control's <input> to its <label>.
const ROOT_LISTENED_BUBBLES = { key: true, focus: false, blur: false } as const;

type RootListened = keyof typeof ROOT_LISTENED_BUBBLES;

function isRootListened(ev: UiEventKind): ev is RootListened {
  return Object.hasOwn(ROOT_LISTENED_BUBBLES, ev);
}

function rootListenedTiles(ev: RootListened): ReadonlySet<string> {
  const reached: readonly string[] = ROOT_LISTENED_BUBBLES[ev]
    ? [...FOCUSABLE_ROOT, ...LABEL_WRAPPED_CONTROL]
    : FOCUSABLE_ROOT;
  return new Set(reached);
}

const LABEL_WRAPPED: ReadonlySet<string> = new Set(LABEL_WRAPPED_CONTROL);

export function labelWrappedUnreached(ev: UiEventKind, kinds: Iterable<string>): string[] {
  if (!isRootListened(ev) || ROOT_LISTENED_BUBBLES[ev]) return [];
  return [...kinds].filter((k) => LABEL_WRAPPED.has(k)).sort();
}

export const UI_LIFTS: ReadonlyArray<UiLift> = [
  {
    ev: "click",
    handler: "onClick",
    tiles: new Set(["button", "check", "switch", "radio"]),
    firesUnheard: { link: "keeps it for navigation" },
  },
  { ev: "submit", handler: "onSubmit", tiles: new Set(["form"]) },
  {
    ev: "change",
    handler: "onChange",
    tiles: new Set(["select", "input", "textarea", "check", "radio", "switch", "slider"]),
  },
  {
    ev: "input",
    handler: "onInput",
    tiles: new Set(["input", "textarea", "editable"]),
    firesUnheard: {
      slider: "listens for it only to write the bind",
      check: 'listens for "change" instead',
      radio: 'listens for "change" instead',
      switch: 'listens for "change" instead',
      select: 'listens for "change" instead',
    },
  },
  { ev: "key", handler: "onKeyDown", tiles: rootListenedTiles("key") },
  { ev: "hover", handler: "onMouseEnter", tiles: null },
  { ev: "focus", handler: "onFocus", tiles: rootListenedTiles("focus") },
  { ev: "blur", handler: "onBlur", tiles: rootListenedTiles("blur") },
];

export function firesUnheardIn(
  ev: UiEventKind,
  kinds: Iterable<string>,
): Array<{ readonly kinds: string[]; readonly instead: string; readonly handler: string }> {
  const lift = UI_LIFTS.find((l) => l.ev === ev);
  const record = lift?.firesUnheard;
  if (lift === undefined || record === undefined) return [];
  const byInstead = new Map<string, string[]>();
  for (const kind of [...kinds].sort()) {
    const instead = Object.hasOwn(record, kind) ? record[kind] : undefined;
    if (instead === undefined) continue;
    byInstead.set(instead, [...(byInstead.get(instead) ?? []), kind]);
  }
  return [...byInstead].map(([instead, grouped]) => ({
    kinds: grouped,
    instead,
    handler: lift.handler,
  }));
}

/** Derived view for the W0212 typecheck — keyed by ui-kind. */
export const UI_EVENT_TILE_KINDS: Record<string, ReadonlySet<string> | null> = Object.fromEntries(
  UI_LIFTS.map((l) => [l.ev, l.tiles]),
);

/** The tile set a `ui.<ev>(Tile)` selector lifts to, looked up by handler name. */
function liftTilesFor(handler: string): ReadonlySet<string> | null {
  return UI_LIFTS.find((l) => l.handler === handler)?.tiles ?? null;
}

export const HANDLER_PROP_TILES: Record<string, ReadonlySet<string> | null> = {
  onClick: liftTilesFor("onClick"),
  onChange: liftTilesFor("onChange"),
  onSubmit: liftTilesFor("onSubmit"),
  onInput: liftTilesFor("onInput"),
  onKeyDown: null,
  onMouseEnter: null,
  onFocus: null,
  onBlur: null,
  onClose: new Set(["modal", "drawer", "popover"]),
};

export const HANDLER_NAMES: ReadonlySet<string> = new Set<string>([
  ...UI_LIFTS.map((l) => l.handler),
  "onClose",
]);

export function handlerReducerName(value: Expr | TileExpr): string | null {
  switch (value.kind) {
    case "Ref":
      return value.name;
    case "Variant":
      return value.payload.length === 0 ? value.name : null;
    case "TileCall":
      return value.args.length === 0 && value.props.length === 0 ? value.name : null;
    default:
      return null;
  }
}

import type { Expr, TileExpr, UiEventKind } from "./ast.ts";

export type UiLift = {
  readonly ev: UiEventKind;
  readonly handler: string;
  readonly tiles: ReadonlySet<string> | null;
  // A kind left out of `tiles` although its element fires `ev`, mapped to what
  // its renderer does with the event instead of calling `handler`.
  readonly firesUnheard?: Readonly<Record<string, string>>;
  // Every element fires `ev`, so a kind left out of `tiles` is left out only
  // because its renderer never calls `handler`.
  readonly everyElementFires?: true;
};

const FOCUSABLE_ROOT = [
  "input",
  "textarea",
  "button",
  "select",
  "slider",
  "editable",
  "link",
  "video",
] as const;

// The runtime's listeners sit on `wrapper`, not on the `focused` element. A
// wrapper that `holdsChildren` would hear a bubbling event from those too: a
// `details` panel's controls carry the lifted `key` listener already, so one
// on the `<details>` would run the reducer twice per key.
const WRAPPED_CONTROL = {
  check: { wrapper: "label", focused: "input", holdsChildren: false },
  radio: { wrapper: "label", focused: "input", holdsChildren: false },
  switch: { wrapper: "label", focused: "input", holdsChildren: false },
  details: { wrapper: "details", focused: "summary", holdsChildren: true },
} as const satisfies Record<string, { wrapper: string; focused: string; holdsChildren: boolean }>;

type WrappedKind = keyof typeof WRAPPED_CONTROL;

function isWrapped(kind: string): kind is WrappedKind {
  return Object.hasOwn(WRAPPED_CONTROL, kind);
}

// The events the runtime listens for on the element a renderer returned, and
// whether each bubbles from a wrapped control's focused element to its wrapper.
const ROOT_LISTENED_BUBBLES = { key: true, focus: false, blur: false } as const;

type RootListened = keyof typeof ROOT_LISTENED_BUBBLES;

function isRootListened(ev: UiEventKind): ev is RootListened {
  return Object.hasOwn(ROOT_LISTENED_BUBBLES, ev);
}

function wrapperHears(ev: RootListened, kind: WrappedKind): boolean {
  return ROOT_LISTENED_BUBBLES[ev] && !WRAPPED_CONTROL[kind].holdsChildren;
}

function rootListenedTiles(ev: RootListened): ReadonlySet<string> {
  const wrapped = Object.keys(WRAPPED_CONTROL).filter((k) => isWrapped(k) && wrapperHears(ev, k));
  return new Set([...FOCUSABLE_ROOT, ...wrapped]);
}

export type WrappedUnreached = {
  readonly kinds: string[];
  readonly wrapper: string;
  readonly focused: string;
  readonly bubbles: boolean;
};

export function wrappedUnreached(ev: UiEventKind, kinds: Iterable<string>): WrappedUnreached[] {
  if (!isRootListened(ev)) return [];
  const groups = new Map<string, WrappedUnreached>();
  for (const kind of [...kinds].sort()) {
    if (!isWrapped(kind) || wrapperHears(ev, kind)) continue;
    const { wrapper, focused } = WRAPPED_CONTROL[kind];
    const at = `${wrapper} ${focused}`;
    const group = groups.get(at) ?? {
      kinds: [],
      wrapper,
      focused,
      bubbles: ROOT_LISTENED_BUBBLES[ev],
    };
    group.kinds.push(kind);
    groups.set(at, group);
  }
  return [...groups.values()];
}

export const UI_LIFTS: ReadonlyArray<UiLift> = [
  {
    ev: "click",
    handler: "onClick",
    tiles: new Set(["button", "check", "switch", "radio"]),
    firesUnheard: { link: "keeps it for navigation" },
    everyElementFires: true,
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

function unheardReason(lift: UiLift, kind: string): string | null {
  if (lift.tiles === null || lift.tiles.has(kind)) return null;
  const record = lift.firesUnheard ?? {};
  const instead = Object.hasOwn(record, kind) ? record[kind] : undefined;
  if (instead !== undefined) return `${instead}, never calling ${lift.handler}`;
  return lift.everyElementFires ? `never calls ${lift.handler}` : null;
}

export function firesUnheardIn(
  ev: UiEventKind,
  kinds: Iterable<string>,
): Array<{ readonly kinds: string[]; readonly reason: string }> {
  const lift = UI_LIFTS.find((l) => l.ev === ev);
  if (lift === undefined) return [];
  const byReason = new Map<string, string[]>();
  for (const kind of [...kinds].sort()) {
    const reason = unheardReason(lift, kind);
    if (reason === null) continue;
    byReason.set(reason, [...(byReason.get(reason) ?? []), kind]);
  }
  return [...byReason].map(([reason, grouped]) => ({ kinds: grouped, reason }));
}

/** Derived view for the W0212 typecheck — keyed by ui-kind. */
export const UI_EVENT_TILE_KINDS: Record<string, ReadonlySet<string> | null> = Object.fromEntries(
  UI_LIFTS.map((l) => [l.ev, l.tiles]),
);

export function liftForHandler(handler: string): UiLift | undefined {
  return UI_LIFTS.find((l) => l.handler === handler);
}

/** The tile set a `ui.<ev>(Tile)` selector lifts to, looked up by handler name. */
function liftTilesFor(handler: string): ReadonlySet<string> | null {
  return liftForHandler(handler)?.tiles ?? null;
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

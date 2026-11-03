import type { Expr, TileExpr, UiEventKind } from "./ast.ts";
import { CHILD_RENDERING_BUILTINS } from "./builtins.ts";

export type UiLift = {
  readonly ev: UiEventKind;
  readonly handler: string;
  readonly tiles: ReadonlySet<string> | null;
  /**
   * Kinds left out of `tiles` whose element fires `ev` but whose renderer never calls `handler`,
   * each mapped to the verb phrase W0212 and W0213 print after "its renderer". A kind named
   * neither here nor in `WRAPPED_KIND` gets the "no descendant fires it" wording, unless the row
   * sets `everyElementFires`.
   */
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
// wrapper that holds children also hears every bubbling event from the tiles
// inside it, and a control there already carries the lifted listener, so one
// on the wrapper as well would run the reducer twice for a key pressed in it.
const WRAPPED_KIND = {
  check: { wrapper: "label", focused: "input" },
  radio: { wrapper: "label", focused: "input" },
  switch: { wrapper: "label", focused: "input" },
  details: { wrapper: "details", focused: "summary" },
} as const satisfies Record<string, { wrapper: string; focused: string }>;

type WrappedKind = keyof typeof WRAPPED_KIND;

function isWrapped(kind: string): kind is WrappedKind {
  return Object.hasOwn(WRAPPED_KIND, kind);
}

// The focus-dependent events the runtime listens for on the element a renderer returned, and
// whether each bubbles from a wrapped kind's focused element to its wrapper.
const ROOT_LISTENED_BUBBLES = { key: true, focus: false, blur: false } as const;

type RootListened = keyof typeof ROOT_LISTENED_BUBBLES;

function isRootListened(ev: UiEventKind): ev is RootListened {
  return Object.hasOwn(ROOT_LISTENED_BUBBLES, ev);
}

function wrapperHears(ev: RootListened, kind: WrappedKind): boolean {
  return ROOT_LISTENED_BUBBLES[ev] && !CHILD_RENDERING_BUILTINS.has(kind);
}

function rootListenedTiles(ev: RootListened): ReadonlySet<string> {
  const wrapped = Object.keys(WRAPPED_KIND).filter((k) => isWrapped(k) && wrapperHears(ev, k));
  return new Set([...FOCUSABLE_ROOT, ...wrapped]);
}

export type WrappedUnreached = {
  readonly kinds: string[];
  readonly wrapper: string;
  readonly focused: string;
  readonly bubbles: boolean;
  readonly handler: string;
};

export function wrappedUnreached(ev: UiEventKind, kinds: Iterable<string>): WrappedUnreached[] {
  const handler = UI_LIFTS.find((l) => l.ev === ev)?.handler;
  if (!isRootListened(ev) || handler === undefined) return [];
  const groups = new Map<string, WrappedUnreached>();
  for (const kind of [...kinds].sort()) {
    if (!isWrapped(kind) || wrapperHears(ev, kind)) continue;
    const { wrapper, focused } = WRAPPED_KIND[kind];
    const at = `${wrapper} ${focused}`;
    const group = groups.get(at) ?? {
      kinds: [],
      wrapper,
      focused,
      bubbles: ROOT_LISTENED_BUBBLES[ev],
      handler,
    };
    group.kinds.push(kind);
    groups.set(at, group);
  }
  return [...groups.values()];
}

// Grouped by this exact text into one clause, so the four kinds share the constant.
const LISTENS_FOR_CHANGE = 'listens for "change" instead';

export const UI_LIFTS: ReadonlyArray<UiLift> = [
  {
    ev: "click",
    handler: "onClick",
    tiles: new Set(["button", "check", "switch", "radio"]),
    firesUnheard: { link: "listens for it only to navigate" },
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
      check: LISTENS_FOR_CHANGE,
      radio: LISTENS_FOR_CHANGE,
      switch: LISTENS_FOR_CHANGE,
      select: LISTENS_FOR_CHANGE,
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

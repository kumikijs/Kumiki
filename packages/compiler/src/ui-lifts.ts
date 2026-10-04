import type { Expr, TileExpr, UiEventKind } from "./ast.ts";

/**
 * Source of truth for the ui-event ⇄ DOM-handler mapping.
 *
 * `ev`: kumiki-side ui-kind (from `ui.<ev>(...)` reducer selectors).
 * `handler`: the JSX-style prop name codegen emits on the tile.
 * `tiles`: root-builtin tile kinds a `ui.<ev>(Tile)` SELECTOR lifts a handler
 *   onto. `null` = any tile (currently only `hover`, which the runtime wires
 *   uniformly via `applyUiEventHandlers`).
 *
 *   For `key` / `focus` / `blur` the runtime attaches the listener to
 *   whatever element a renderer returned, so which kinds a selector reaches
 *   is decided by where those events arrive at that element — see
 *   `FOCUSABLE_ROOT`, `WRAPPED_CONTROL` and `ROOT_LISTENED_BUBBLES`, which the
 *   three rows are built from. For `click` / `submit` / `change` /
 *   `input` each kind's renderer decides whether it calls the handler, and an
 *   absence there records that decision. Some are facts about the element
 *   (`editable` fires no `change`); some are runtime policy (`link` reserves
 *   `click` for navigation, and `slider` listens for `input` only to write its
 *   bind, never calling `onInput`). The comment on each row says which.
 * `firesUnheard`: the runtime-policy absences of that row — a kind left out of
 *   `tiles` although its element fires `ev`, mapped to what its renderer does
 *   with the event instead of calling `handler`. W0212 gives that as its
 *   reason. For a left-out kind found neither here nor by `wrappedUnreached`,
 *   it says no descendant fires the event.
 *
 * Consumers:
 *  - `codegen/selector.ts#propsFor` — emits one chained handler per row when
 *    an enclosing tile of an allowed kind has matching reducers, and captures
 *    explicit `onX=r` wirings so they are not re-emitted as data props.
 *  - `typecheck.ts#checkReducer` — emits W0212 when a reducer's selector
 *    targets a tile not listed in `tiles`, giving the reason
 *    `wrappedUnreached` or `firesUnheardIn` names when one names one;
 *    `checkTile` resolves an explicit handler's value as a reducer name
 *    rather than an expression.
 *  - `references.ts` — the same resolution for the AI-editing verbs, so
 *    `refs` / `rename` / `remove --cascade` see the handler → reducer edge.
 *  - `docs/spec/errors.md` §W0212 — published version of this table.
 *
 * Adding a new ui-kind takes one row here (plus the `UiEventKind` enum
 * entry in `ast.ts` and the grammar in `docs/spec/language.md`).
 *
 * Runtime-event ≠ emit-prop: for `check / radio / switch` the runtime
 * listens to the DOM `change` event but invokes `onClick` (see
 * `packages/runtime/src/tiles/input/`). The compile-time table only
 * encodes (ev → emit-prop) + (ev → allowed tile-kinds); the runtime
 * renderers own the (tile, handler) → DOM-event resolution.
 */
export type UiLift = {
  readonly ev: UiEventKind;
  readonly handler: string;
  readonly tiles: ReadonlySet<string> | null;
  readonly firesUnheard?: Readonly<Record<string, string>>;
};

/**
 * Kinds whose rendered element is itself focusable, so `focus`, `blur` and
 * `keydown` all arrive at the element the runtime attaches its listeners to
 * (`applyUiEventHandlers`). The `key` / `focus` / `blur` rows are built from
 * this list, `WRAPPED_CONTROL` and `ROOT_LISTENED_BUBBLES`, so the three rows
 * cannot drift apart.
 *
 * - `input` / `textarea` / `button` / `select` / `slider`: form controls (a
 *   `slider` is a bare `<input type="range">`, operated with arrow keys).
 * - `editable`: a `<div contenteditable="true">` is an editing host, so it is
 *   focusable without a `tabindex` (its `tabIndex` IDL attribute reads -1,
 *   the reflection default, which says nothing about the tab order).
 * - `link`: an `<a>` whose `href` is always assigned, so it is focusable and in
 *   the tab order. A keydown on it runs `ui.key(Link)` BEFORE the browser acts
 *   on the key: on Enter the browser then activates the link, and the link's
 *   own click listener navigates as always. The reducer sees the key and
 *   cannot stop the navigation. This is unlike `click`, which the link reserves
 *   for navigation and which is therefore absent from the `click` row.
 * - `video`: a `<video>` rendered with `controls` is focusable and in the tab
 *   order. It receives `focus` and `blur` as focus enters and leaves it as a
 *   whole; moving between its own play / volume / fullscreen buttons fires
 *   neither on it. It receives the keydown of a key pressed while it has focus
 *   itself (Space then plays or pauses it), and not that of one pressed while
 *   one of those buttons has focus. Measured in Chromium.
 *
 * What this list cannot answer is whether one *instance* can take focus: a
 * `disabled` control, an `editable` rendered `contenteditable="false"`, or a
 * `video` rendered without `controls` fires none of the three. That is a
 * runtime property of the element.
 */
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

/**
 * Kinds whose renderer returns an element WRAPPING the one that takes focus,
 * so the runtime's listeners sit on the `wrapper` and not on the `focused`
 * element. Which events reach the wrapper is `ROOT_LISTENED_BUBBLES`: `focus`
 * and `blur` do NOT bubble, so no `ui.focus` / `ui.blur` listener on the
 * wrapper ever runs, and W0212 is correct to emit for them. `keydown` BUBBLES,
 * so a listener on the wrapper hears it, together with the keydown of anything
 * else the wrapper holds (`holdsChildren`):
 *
 * - `check` / `radio` / `switch`: a `<label>` around their `<input>` and
 *   nothing else, so a `ui.key` selector lands on the label.
 * - `details`: a `<details>` around its `<summary>` AND the tiles of its
 *   panel. A control in the panel that the `key` row lists carries the same
 *   subscription lifted onto it, and its keydown bubbles on to the
 *   `<details>`, so a listener there would run the reducer a second time for
 *   each key. No `key` listener is lifted onto a `details` either.
 *
 * The focused element does fire the event in every case, so W0212 gives that
 * reason (`wrappedUnreached`) rather than saying no descendant fires it. These
 * kinds look like one case with the focusable roots and are two.
 */
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

/**
 * The three events the runtime listens for on the element a renderer returned
 * (`applyUiEventHandlers`; its fourth listener, `mouseenter`, is the `hover`
 * row, which any tile takes), and whether each bubbles. A `FOCUSABLE_ROOT`
 * kind receives all three on that element. A `WRAPPED_CONTROL` kind receives
 * only the ones that bubble from its focused element to its wrapper, and only
 * where the wrapper holds nothing else (`wrapperHears`).
 *
 * The `key` / `focus` / `blur` rows are built from this, and so is the reason
 * W0212 gives for a wrapped kind a row leaves out, so the row and the reason
 * cannot disagree.
 */
const ROOT_LISTENED_BUBBLES = { key: true, focus: false, blur: false } as const;

type RootListened = keyof typeof ROOT_LISTENED_BUBBLES;

function isRootListened(ev: UiEventKind): ev is RootListened {
  return Object.hasOwn(ROOT_LISTENED_BUBBLES, ev);
}

/** Whether a listener on `kind`'s wrapper hears `ev` from its focused element alone. */
function wrapperHears(ev: RootListened, kind: WrappedKind): boolean {
  return ROOT_LISTENED_BUBBLES[ev] && !WRAPPED_CONTROL[kind].holdsChildren;
}

/** The kinds a `key` / `focus` / `blur` selector reaches. */
function rootListenedTiles(ev: RootListened): ReadonlySet<string> {
  const wrapped = Object.keys(WRAPPED_CONTROL).filter((k) => isWrapped(k) && wrapperHears(ev, k));
  return new Set([...FOCUSABLE_ROOT, ...wrapped]);
}

/** Wrapped kinds that share a wrapper and a focused element, and the event that misses them. */
export type WrappedUnreached = {
  readonly kinds: string[];
  readonly wrapper: string;
  readonly focused: string;
  /**
   * `ev` bubbles from `focused` to `wrapper`, so what keeps it from a listener
   * is the other tiles the wrapper holds; otherwise it is that it does not
   * bubble.
   */
  readonly bubbles: boolean;
};

/**
 * The wrapped kinds among `kinds` whose focused element fires `ev` where no
 * listener of theirs receives it: `ev` is one the runtime listens for on the
 * wrapper, and it does not bubble there, or it does and the wrapper holds
 * other tiles whose `ev` a listener there would hear too. Grouped by wrapper
 * and focused element, each group's kinds sorted, the groups in the order of
 * their first kind. Empty when that is not why `ev` misses these kinds: for an
 * event the wrapper hears (`key` on a `check`), and for one the focused
 * element does not fire at all (`submit`).
 *
 * W0212 reads it to say so. For these kinds "no descendant fires it" is
 * untrue, because the focused element does.
 */
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
    // `link` is intentionally omitted even though `<a>` fires click natively:
    // the runtime's link renderer reserves the click event for navigation
    // interception and does not invoke user `onClick` reducers
    // (`packages/runtime/src/tiles/text/`). Lifting that requires a separate
    // runtime change. Runtime policy, so it is recorded in `firesUnheard`.
    tiles: new Set(["button", "check", "switch", "radio"]),
    firesUnheard: { link: "keeps it for navigation" },
  },
  { ev: "submit", handler: "onSubmit", tiles: new Set(["form"]) },
  {
    ev: "change",
    handler: "onChange",
    // `editable` is absent because a `<div contenteditable>` fires no `change`
    // event at all — the omission is the rule here, not a gap.
    tiles: new Set(["select", "input", "textarea", "check", "radio", "switch", "slider"]),
  },
  {
    ev: "input",
    handler: "onInput",
    // An `editable` does fire `input`, and its renderer calls the tile's
    // `onInput` from that listener, so a selector lands on it like any other
    // text control. The kinds in `firesUnheard` are absent by their renderers'
    // choice, not the DOM's: an `<input type="range">`, a checkbox, a radio and
    // a `<select>` all fire `input`. The `slider` renderer listens to it to
    // write the bind; the others listen for `change` alone. None of them calls
    // `onInput`.
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

/**
 * The kinds among `kinds` that fire `ev` where no reducer hears it, from the
 * row's `firesUnheard`: grouped by what their renderer does with the event
 * instead, each group's kinds sorted, the groups in the order of their first
 * kind. Empty for a kind whose element fires nothing, and for every kind of
 * a row with no such record.
 *
 * W0212 reads it to say so. For these kinds "no descendant fires it" is
 * untrue, because the element does.
 */
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

/**
 * Which tile kinds honour a handler prop that is written on them directly —
 * `button(text="x", onClick=r)`, `row(...) {onKeyDown: r}`. `null` means the
 * runtime attaches the listener whatever the tile is.
 *
 * Not the same question as `UI_EVENT_TILE_KINDS`, which answers where a
 * `ui.<ev>(Tile)` *selector* lands, so the sets are related but not equal:
 * `onClose` is honoured by the overlay tiles and no ui-event lifts to it at
 * all. Every entry below is therefore derived from the lift table except
 * `onClose`, which the lift table cannot supply.
 *
 * The four `null`s are the handlers `applyUiEventHandlers` installs on
 * whatever element the tile produced. That is about the LISTENER, not about
 * the event reaching it: `focus` and `blur` do not bubble, so a plain `div` —
 * one that is neither `contenteditable` nor given a `tabindex` — never fires
 * them, and `keydown` reaches a container only from a focusable descendant.
 * (`editable` is the `contenteditable` case, which is why it sits in those
 * rows of the lift table.) Reporting them would need a focusability answer
 * for the tile's root. `FOCUSABLE_ROOT` above is one, but this table does not
 * consult it, and whether it should is an open question rather than a
 * settled "different check".
 */
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

/**
 * All handler-prop names that bind a reducer rather than a value, in both the
 * `f(onX=r)` and `f() {onX: r}` forms. Read by codegen (capture the explicit
 * wiring, and skip it when building the `el` payload), by the typechecker
 * (resolve the name as a reducer), and by the reference walker (record the
 * edge). Includes `onClose` even though no ui-event lifts to it — it is an
 * explicit-only handler the overlay tiles (`modal`, `drawer`, `popover`)
 * accept via the late-flush path.
 */
export const HANDLER_NAMES: ReadonlySet<string> = new Set<string>([
  ...UI_LIFTS.map((l) => l.handler),
  "onClose",
]);

/**
 * The reducer a handler binding names, or `null` when the value is not a name.
 *
 * A handler position is resolved in the reducer namespace (§1.7.3), so what
 * decides the value is the name written there — not the shape the parser gave
 * it. Which shape arrives is decided by capitalisation and by the tile the
 * argument sits on (`parseArgValue` branches on `VALUE_ARG_BUILTINS`), neither
 * of which the author is saying anything with in this position:
 *
 *  - `Ref` — a lowercase name, in either form.
 *  - `TileCall` with no arguments and no props — a named argument of a builtin
 *    that takes tiles (`box(text("x"), onClick=Bump)`). Capitalisation is not
 *    what routes here: a lowercase builtin's name lands in this branch too,
 *    and `onClick=divider()` answers `divider`, which resolves to no reducer.
 *  - `Variant` with an empty payload — a capitalised name everywhere else: a
 *    props block, a named argument of a value-arg builtin such as `link`, and
 *    a named argument of a user tile.
 *
 * The call and brace forms are the same node as the bare name: the parser
 * gives `onClick=Bump`, `onClick=Bump()` and `onClick=Bump {}` one identical
 * `TileCall`, and `Bump` / `Bump()` one identical `Variant`. Nothing here can
 * tell them apart, so all of them name the reducer — which is what
 * `docs/spec/language.md` §1.7.3 says.
 *
 * Anything else is not a name and answers `null`: `1`, a variant tag carrying
 * a payload (`Some(1)`), and a tile call carrying arguments (`box(text("z"))`)
 * or props (`Card {x: 1}`). Those emptiness tests are load-bearing in three
 * files at once, and relaxing them fails silently in all three: the checker
 * (`checkHandlerBinding`) would stop reporting a nested tile, codegen
 * (`propsFor`'s `recordExplicit`) would swallow the value, and the reference
 * walker (`tileArg`) would stop walking the subtree. Only the checker half is
 * pinned by a test. Concretely: `onClick=Some(1)` would be read as a reducer
 * called `Some`, and a listener wired for a reducer nobody named.
 *
 * One function rather than one shape test per consumer: the checker, codegen
 * and the reference walker have to agree about what a handler names, and each
 * deciding for itself is what left a capitalised reducer name accepted by one
 * and invisible to the others.
 */
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

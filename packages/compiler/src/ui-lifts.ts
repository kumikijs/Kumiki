import type { UiEventKind } from "./ast.ts";

/**
 * Source of truth for the ui-event ⇄ DOM-handler mapping.
 *
 * `ev`: kumiki-side ui-kind (from `ui.<ev>(...)` reducer selectors).
 * `handler`: the JSX-style prop name codegen emits on the tile.
 * `tiles`: root-builtin tile kinds that can actually fire this event at
 *   runtime. `null` = any tile (currently only `hover`, which the runtime
 *   wires uniformly via `applyUiEventHandlers`).
 *
 * Consumers:
 *  - `codegen/selector.ts#propsFor` — emits one chained handler per row when
 *    an enclosing tile of an allowed kind has matching reducers, and captures
 *    explicit `onX=r` wirings so they are not re-emitted as data props.
 *  - `typecheck.ts#checkReducer` — emits W0212 when a reducer's selector
 *    targets a tile not listed in `tiles`; `checkTile` resolves an explicit
 *    handler's value as a reducer name rather than an expression.
 *  - `references.ts` — the same resolution for the AI-editing verbs, so
 *    `refs` / `rename` / `remove --cascade` see the handler → reducer edge.
 *  - `docs/spec/errors.md` §W0212 — published version of this table.
 *
 * Adding a new ui-kind takes one row here (plus the `UiEventKind` enum
 * entry in `ast.ts` and the grammar in `docs/spec/language.md`).
 *
 * Runtime-event ≠ emit-prop: for `check / radio / switch` the runtime
 * listens to the DOM `change` event but invokes `onClick` (see
 * `packages/runtime/src/tiles-input.ts`). The compile-time table only
 * encodes (ev → emit-prop) + (ev → allowed tile-kinds); the runtime
 * renderers own the (tile, handler) → DOM-event resolution.
 */
export type UiLift = {
  readonly ev: UiEventKind;
  readonly handler: string;
  readonly tiles: ReadonlySet<string> | null;
};

export const UI_LIFTS: ReadonlyArray<UiLift> = [
  {
    ev: "click",
    handler: "onClick",
    // `link` is intentionally omitted even though `<a>` fires click natively:
    // the runtime's link renderer reserves the click event for navigation
    // interception and does not invoke user `onClick` reducers
    // (`packages/runtime/src/tiles-text.ts`). Lifting that requires a separate
    // runtime change.
    tiles: new Set(["button", "check", "switch", "radio"]),
  },
  { ev: "submit", handler: "onSubmit", tiles: new Set(["form"]) },
  {
    ev: "change",
    handler: "onChange",
    // `editable` is absent because a `<div contenteditable>` fires no `change`
    // event at all — the omission is the rule here, not a gap.
    tiles: new Set(["select", "input", "textarea", "check", "radio", "switch", "slider"]),
  },
  // An `editable` does fire `input`, and its renderer calls the tile's
  // `onInput` from that listener, so a selector lands on it like any other
  // text control.
  { ev: "input", handler: "onInput", tiles: new Set(["input", "textarea", "editable"]) },
  // `key` / `focus` / `blur` are the three the runtime attaches to whatever
  // element a tile produced, so what these rows list is where a *selector*
  // reaches — narrower than what fires the event. A kind missing from them is
  // a gap in this table rather than a fact about the DOM.
  { ev: "key", handler: "onKeyDown", tiles: new Set(["input", "textarea", "button"]) },
  { ev: "hover", handler: "onMouseEnter", tiles: null },
  {
    ev: "focus",
    handler: "onFocus",
    tiles: new Set(["input", "textarea", "button", "select"]),
  },
  {
    ev: "blur",
    handler: "onBlur",
    tiles: new Set(["input", "textarea", "button", "select"]),
  },
];

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
 * the event reaching it: `focus` and `blur` do not bubble, so a `div` with no
 * `tabindex` never fires them, and `keydown` reaches a container only from a
 * focusable descendant. Reporting them would need to know about focusability,
 * which is a different check from this one.
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

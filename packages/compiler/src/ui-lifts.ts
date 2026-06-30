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
 *  - `codegen.ts#propsFor` — emits one chained handler per row when an
 *    enclosing tile of an allowed kind has matching reducers.
 *  - `typecheck.ts#checkReducer` — emits W0212 when a reducer's selector
 *    targets a tile not listed in `tiles`.
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
    tiles: new Set(["button", "check", "switch", "radio"]),
  },
  { ev: "submit", handler: "onSubmit", tiles: new Set(["form"]) },
  {
    ev: "change",
    handler: "onChange",
    tiles: new Set(["select", "input", "textarea", "check", "radio", "switch", "slider"]),
  },
  { ev: "input", handler: "onInput", tiles: new Set(["input", "textarea"]) },
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

/**
 * All handler-prop names codegen recognises as event-handler args/props
 * (used for: capturing explicit `onX=fn` wirings, and skipping them when
 * building the `el` payload). Includes `onClose` even though no ui-event
 * lifts to it — it is an explicit-only handler some tiles (`dialog` etc.)
 * accept via the late-flush path.
 */
export const HANDLER_NAMES: ReadonlySet<string> = new Set<string>([
  ...UI_LIFTS.map((l) => l.handler),
  "onClose",
]);

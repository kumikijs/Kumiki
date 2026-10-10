import type { Expr, TileExpr, UiEventKind } from "./ast.ts";

export type UiLift = {
  readonly ev: UiEventKind;
  readonly handler: string;
  readonly tiles: ReadonlySet<string> | null;
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
  { ev: "input", handler: "onInput", tiles: new Set(["input", "textarea", "editable"]) },
  {
    ev: "key",
    handler: "onKeyDown",
    tiles: new Set([...FOCUSABLE_ROOT, ...LABEL_WRAPPED_CONTROL]),
  },
  { ev: "hover", handler: "onMouseEnter", tiles: null },
  { ev: "focus", handler: "onFocus", tiles: new Set(FOCUSABLE_ROOT) },
  { ev: "blur", handler: "onBlur", tiles: new Set(FOCUSABLE_ROOT) },
];

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

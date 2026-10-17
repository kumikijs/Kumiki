import type { Expr, TileArg, TileExpr } from "./ast.ts";
import { isTileExpr } from "./ast.ts";

export const BUILTIN_TILES = new Set<string>([
  // Structural
  "page",
  "region",
  "row",
  "column",
  "stack",
  "overlay",
  "grid",
  "box",
  "card",
  "panel",
  "divider",
  "scroll",
  // Text
  "text",
  "heading",
  "link",
  "code",
  "markdown",
  // Media
  "image",
  "icon",
  "video",
  // Input
  "button",
  "input",
  "textarea",
  "check",
  "radio",
  "select",
  "slider",
  "switch",
  "editable",
  // Forms
  "form",
  "label",
  "fieldset",
  "error",
  // Lists / Tables
  "list",
  "list-item",
  "table",
  "table-head",
  "table-body",
  "table-row",
  "table-cell",
  // Overlays
  "modal",
  "drawer",
  "tooltip",
  "popover",
  "toast",
  "details",
  // Feedback
  "spinner",
  "progress",
  "skeleton",
  // Control
  "route-outlet",
]);

export function positionalIsTile(name: string): boolean {
  return BUILTIN_TILES.has(name) && !VALUE_ARG_BUILTINS.has(name);
}

// Codegen renders such a name as the tile; the checker and the reference graph must agree.
export function tileNamedAt(
  callee: string,
  arg: TileArg,
  isTile: (name: string) => boolean,
): (Expr & { kind: "Ref" }) | undefined {
  const v = arg.value;
  if (arg.name !== undefined || !positionalIsTile(callee)) return undefined;
  if (isTileExpr(v) || v.kind !== "Ref") return undefined;
  return isTile(v.name) ? v : undefined;
}

export type TileFamily =
  | "layout"
  | "text"
  | "input"
  | "collection"
  | "overlay"
  | "media"
  | "status";

export const PER_TILE_FAMILIES: readonly TileFamily[] = ["text", "input"];

export function isPerTileFamily(family: TileFamily | undefined): family is TileFamily {
  return family !== undefined && PER_TILE_FAMILIES.includes(family);
}

export const PER_TILE_FAMILY_SHARED: Partial<Record<TileFamily, string>> = {
  input: "tiles-input-shared",
};

export const EFFECT_HANDLERS_SHARED = "effects-decode";

export function tileModule(kind: string): string | undefined {
  const family = TILE_FAMILY[kind];
  if (!family) return undefined;
  return PER_TILE_FAMILIES.includes(family) ? `tiles-${family}-${kind}` : `tiles-${family}`;
}

export const TILE_FAMILY: Record<string, TileFamily> = {
  // tiles-layout
  page: "layout",
  region: "layout",
  row: "layout",
  column: "layout",
  stack: "layout",
  grid: "layout",
  box: "layout",
  card: "layout",
  panel: "layout",
  divider: "layout",
  scroll: "layout",
  fieldset: "layout",
  "route-outlet": "layout",
  // tiles-text
  text: "text",
  heading: "text",
  link: "text",
  code: "text",
  markdown: "text",
  label: "text",
  icon: "text",
  // tiles-input
  button: "input",
  input: "input",
  textarea: "input",
  check: "input",
  radio: "input",
  select: "input",
  slider: "input",
  switch: "input",
  form: "input",
  editable: "input",
  // tiles-collection
  list: "collection",
  "list-item": "collection",
  table: "collection",
  "table-head": "collection",
  "table-body": "collection",
  "table-row": "collection",
  "table-cell": "collection",
  // tiles-overlay
  overlay: "overlay",
  modal: "overlay",
  drawer: "overlay",
  tooltip: "overlay",
  popover: "overlay",
  details: "overlay",
  // tiles-media
  image: "media",
  video: "media",
  // tiles-status
  toast: "status",
  spinner: "status",
  progress: "status",
  skeleton: "status",
  error: "status",
};

/** One row of `VALUE_BUILTIN_CONTENT`: where a value builtin reads its content. */
export type ContentReading = { readonly positional: boolean; readonly named?: string };

export const VALUE_BUILTIN_CONTENT = {
  text: { positional: true },
  heading: { positional: true },
  markdown: { positional: true },
  code: { positional: true },
  label: { positional: true, named: "text" },
  link: { positional: true, named: "text" },
  editable: { positional: true, named: "text" },
  image: { positional: false, named: "src" },
  icon: { positional: false, named: "name" },
} as const satisfies Record<string, ContentReading>;

/** How `name` reads its content, or `undefined` when it is not a value builtin. */
export function contentReading(name: string): ContentReading | undefined {
  return Object.hasOwn(VALUE_BUILTIN_CONTENT, name)
    ? VALUE_BUILTIN_CONTENT[name as keyof typeof VALUE_BUILTIN_CONTENT]
    : undefined;
}

export const VALUE_ARG_BUILTINS: ReadonlySet<string> = new Set(Object.keys(VALUE_BUILTIN_CONTENT));

export function contentArg(t: TileExpr & { kind: "TileCall" }): TileArg | undefined {
  const reading = contentReading(t.name);
  if (!reading) return undefined;
  const positional = reading.positional ? t.args.find((a) => a.name === undefined) : undefined;
  return positional ?? (reading.named ? t.args.find((a) => a.name === reading.named) : undefined);
}

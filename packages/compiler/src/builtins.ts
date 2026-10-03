// Single source of truth for the built-in tile registry.
//
// The lexer/parser, the typechecker, and codegen each used to keep their own
// copy of this set. They drifted: the parser/typechecker accepted the full
// documented set (stdlib §2.3) while codegen implemented only a subset, so a
// documented tile could pass `check` yet throw `Tile "<name>" not found` at
// `build` (issue #61). Deriving all three layers from this one module makes
// that class of drift structurally impossible — a tile listed here must be
// handled by codegen, or the build fails loudly in CI via the registry test.

import type { TileArg, TileExpr } from "./ast.ts";

/**
 * Every tile the spec documents as built-in (stdlib §2.3). The parser uses this
 * to distinguish built-in tile calls from user-tile references; the typechecker
 * uses it to accept a tile name without a user definition; codegen uses it to
 * route a call to its built-in renderer rather than looking up a user tile.
 */
export const BUILTIN_TILES = new Set<string>([
  // §2.3.1 Structural
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
  // §2.3.2 Text
  "text",
  "heading",
  "link",
  "code",
  "markdown",
  // §2.3.3 Media
  "image",
  "icon",
  "video",
  // §2.3.4 Input
  "button",
  "input",
  "textarea",
  "check",
  "radio",
  "select",
  "slider",
  "switch",
  "editable",
  // §2.3.5 Forms
  "form",
  "label",
  "fieldset",
  "error",
  // §2.3.6 Lists / Tables
  "list",
  "list-item",
  "table",
  "table-head",
  "table-body",
  "table-row",
  "table-cell",
  // §2.3.7 Overlays
  "modal",
  "drawer",
  "tooltip",
  "popover",
  "toast",
  "details",
  // §2.3.8 Feedback
  "spinner",
  "progress",
  "skeleton",
  // §2.3.9 Control
  "route-outlet",
]);

/**
 * Whether `name` renders a positional argument only when it is a tile: a
 * builtin that is not a value builtin. Codegen lowers a positional argument of
 * one as a child (`column`, `row`, `card`, …) or not at all (`button`,
 * `progress`, …), and in either case a value there renders nothing — the
 * checker reports it (E0128). A user tile's positional argument is its input,
 * a value.
 */
export function positionalIsTile(name: string): boolean {
  return BUILTIN_TILES.has(name) && !VALUE_ARG_BUILTINS.has(name);
}

/**
 * Which runtime feature module (`@kumikijs/runtime/modules/tiles-*.js`)
 * renders each built-in tile (#71). Codegen uses this to import only the
 * families a compiled app touches; the mapping MUST match the runtime's
 * `tiles-*.ts` module contents (a cross-package test pins the two together).
 */
export type TileFamily =
  | "layout"
  | "text"
  | "input"
  | "collection"
  | "overlay"
  | "media"
  | "status";

/**
 * Families whose tiles ship one runtime module EACH, rather than one module
 * for the family (#71).
 *
 * A family is on this list when its tiles are genuinely separate code. `text`
 * is: `link` carries a URL-disposition check, an allowlist and a
 * once-per-target diagnostic, `icon` a theme-override lookup and a size scale,
 * and `heading` is six lines — an app with a heading used to download all of
 * it. `layout` is not, and must not be: of the thirteen kinds mapped to it,
 * twelve are rendered by five functions (`page` and `column` are both
 * `renderFlexColumn`; seven more — `card`, `box`, `panel`, `fieldset`,
 * `stack`, `region`, `scroll` — are all `renderBox`), and the thirteenth,
 * `route-outlet`, has no renderer of its own at all. Splitting it would ship
 * the same bytes under more names.
 *
 * Every kind of a listed family must have its own module, because the module
 * name is derived from the kind (`tiles-text-link`); a cross-package test pins
 * that against what the runtime build emits.
 */
export const PER_TILE_FAMILIES: readonly TileFamily[] = ["text", "input"];

/**
 * Whether `family` — which may be `undefined`, because `TILE_FAMILY` does not
 * know a user-defined tile — ships one module per tile. A predicate rather
 * than an `includes` call at each site, so the narrowing is written once
 * instead of as a cast at every caller.
 */
export function isPerTileFamily(family: TileFamily | undefined): family is TileFamily {
  return family !== undefined && PER_TILE_FAMILIES.includes(family);
}

/**
 * The module a per-tile family's tiles import in common, when it has one.
 * Not imported by the generated header — the tile modules reference it
 * relatively — but it has to be COPIED next to them, so it belongs in the
 * module list `kumiki build` ships.
 */
export const PER_TILE_FAMILY_SHARED: Partial<Record<TileFamily, string>> = {
  input: "tiles-input-shared",
};

/**
 * The module the decoding effect handlers — `effects-storage`,
 * `effects-indexed`, `effects-http` — import in common: the `Decoder.Json(T)`
 * check (http.md §6.1.4). Like {@link PER_TILE_FAMILY_SHARED}, the handlers
 * reference it relatively, so it ships with them without a header import.
 */
export const EFFECT_HANDLERS_SHARED = "effects-decode";

/**
 * The runtime module that renders `kind` — `tiles-text-link` for a tile that
 * ships alone, `tiles-layout` for one that ships with its family.
 */
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

/**
 * Where each value builtin reads its content (language.md §1.7.1, stdlib.md
 * §2.3), and so which of the arguments written as content it renders.
 *
 * - `positional`: the first positional argument is the content. A second one
 *   is never rendered.
 * - `named`: the named argument read as the content when no positional one is
 *   written, and never read when one is — `label` / `link` / `editable` take
 *   their label as `text=`, and `image` / `icon`, which read no positional
 *   argument at all, take theirs as `src=` / `name=`.
 *
 * The lowering reads the content through `contentArg`, and the checker reports
 * every argument this table says is dropped (E0129), so what `check` accepts
 * is what renders. A builtin in this table is a value builtin: its positional
 * argument parses as a value, never as a child tile — `heading("Hi")`,
 * `code("const x = 1", lang="ts")`.
 */
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

/**
 * Built-in tiles whose positional argument is a *value* expression rather than
 * a child tile. Everything else treats positional args as child tiles.
 */
export const VALUE_ARG_BUILTINS: ReadonlySet<string> = new Set(Object.keys(VALUE_BUILTIN_CONTENT));

/**
 * The argument a value builtin renders as its content: its first positional
 * argument when it reads one, else its named content argument; `undefined`
 * when neither is written or `t` is not a value builtin.
 */
export function contentArg(t: TileExpr & { kind: "TileCall" }): TileArg | undefined {
  const reading = contentReading(t.name);
  if (!reading) return undefined;
  const positional = reading.positional ? t.args.find((a) => a.name === undefined) : undefined;
  return positional ?? (reading.named ? t.args.find((a) => a.name === reading.named) : undefined);
}

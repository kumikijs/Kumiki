// Single source of truth for the built-in tile registry.
//
// The lexer/parser, the typechecker, and codegen each used to keep their own
// copy of this set. They drifted: the parser/typechecker accepted the full
// documented set (stdlib §2.3) while codegen implemented only a subset, so a
// documented tile could pass `check` yet throw `Tile "<name>" not found` at
// `build` (issue #61). Deriving all three layers from this one module makes
// that class of drift structurally impossible — a tile listed here must be
// handled by codegen, or the build fails loudly in CI via the registry test.

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
 * Which runtime feature module (`@kumikijs/runtime/modules/tiles-<family>.js`)
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

/**
 * Built-in tiles whose single positional argument is a *value* expression
 * (Text / Number / …) rather than a child tile — e.g. `heading("Hi")`,
 * `code("const x = 1", lang="ts")`. Everything else treats positional args as
 * child tiles.
 */
export const VALUE_ARG_BUILTINS = new Set<string>([
  "text",
  "heading",
  "markdown",
  "label",
  "link",
  "image",
  "icon",
  "code",
  "editable",
]);

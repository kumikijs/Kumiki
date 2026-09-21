// Public API of @kumikijs/compiler.

// The did-you-mean metric and the ranking built on it. Published because
// `kumiki fix` repairs with them, and two copies of one rule is two answers to
// "which name did they mean". They are implemented in `@kumikijs/runtime`, the
// package below both this one and the verification tiers that rank reducer
// names the same way — re-exported here so the CLI's import is unchanged.
// Imported through the `text-distance` subpath rather than the barrel: this
// module is loaded on every `kumiki check`, and the barrel would pull the whole
// runtime module graph in to reach two pure functions.
export { levenshtein, nearestName } from "@kumikijs/runtime/text-distance";
export type * from "./ast.ts";
// The name tables themselves stay internal: splitting them three ways is an
// implementation choice (one lowers by full name, one by member, one not at
// all), and freezing that split into the published API would make merging them
// — into a single map carrying arity and lowering kind — a breaking change.
export { calleeCandidates, isBuiltinCallee } from "./builtin-calls.ts";
export {
  BUILTIN_TILES,
  isPerTileFamily,
  PER_TILE_FAMILIES,
  PER_TILE_FAMILY_SHARED,
  TILE_FAMILY,
  type TileFamily,
  tileModule,
  VALUE_ARG_BUILTINS,
} from "./builtins.ts";
export {
  BUILTIN_EFFECT_CAPS,
  type CapabilityManifest,
  type ManifestResult,
  parseCapabilityManifest,
  STANDARD_CAPABILITIES,
} from "./capabilities.ts";
// The two halves of a refinement, for the same reason: `applyRefine` folds a
// predicate into a property-test generator's descriptor and `refinementToJs`
// lowers the same predicate to the runtime's check, in two packages. A
// generated value has to pass the check the runtime applies to a write
// (testing.md §8.3.2), which is a property neither side can state alone.
export { applyRefine, type GenDescData } from "./codegen/emit-type.ts";
// The write-path encoding the runtime decodes. Exported so the two
// declarations can be checked against each other.
export { type BindSegment, isUnwrapStep, UNWRAP_SEGMENT } from "./codegen/path-segment.ts";
export {
  type CodegenOptions,
  type CodegenResult,
  codegen,
  FIELD_ACCESS_SHORTCUTS,
  KNOWN_MEMBERS,
  KNOWN_METHODS,
  RUNTIME_HELPERS,
} from "./codegen.ts";
export {
  type CompileFail,
  type CompileOk,
  type CompileResult,
  compile,
  type ExtendedCodegenOptions,
  inlineRuntime,
} from "./compile.ts";
export { generateDts } from "./dts.ts";
// `LexError` travels with `ParseError`: both escape `compile()` as exceptions
// carrying a source position, and a caller that renders them as located
// diagnostics — the Vite plugin, whose overlay links to the line — cannot
// narrow what it cannot name.
export { LexError, lex } from "./lexer.ts";
export { ParseError, parse } from "./parser.ts";
export {
  buildDefIndex,
  type DefIndex,
  layerOfDef,
  type Reference,
  type RefLayer,
  referencesIn,
} from "./references.ts";
export { refinementToJs } from "./refinements.ts";
// Same reasoning as the call tables above: the definitions themselves stay
// internal, and only the candidate-set question a repair asks is published.
export { typeCandidates } from "./stdlib-types.ts";
export { collectTimerNames, variantTagsOf } from "./symbols.ts";
export { A11Y_CODES, check, type KumikiError, ROUTE_SLOT_FIELDS } from "./typecheck.ts";

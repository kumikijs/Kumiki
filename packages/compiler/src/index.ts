// Public API of @kumikijs/compiler.
export type * from "./ast.ts";
// The name tables themselves stay internal: splitting them three ways is an
// implementation choice (one lowers by full name, one by member, one not at
// all), and freezing that split into the published API would make merging them
// — into a single map carrying arity and lowering kind — a breaking change.
export { calleeCandidates, isBuiltinCallee } from "./builtin-calls.ts";
export { BUILTIN_TILES, TILE_FAMILY, type TileFamily, VALUE_ARG_BUILTINS } from "./builtins.ts";
export {
  BUILTIN_EFFECT_CAPS,
  type CapabilityManifest,
  type ManifestResult,
  parseCapabilityManifest,
  STANDARD_CAPABILITIES,
} from "./capabilities.ts";
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
// Same reasoning as the call tables above: the definitions themselves stay
// internal, and only the candidate-set question a repair asks is published.
export { typeCandidates } from "./stdlib-types.ts";
export { collectTimerNames, variantTagsOf } from "./symbols.ts";
export { A11Y_CODES, check, type KumikiError, ROUTE_SLOT_FIELDS } from "./typecheck.ts";

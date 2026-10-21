export { levenshtein, nearestName } from "@kumikijs/runtime/text-distance";
export type * from "./ast.ts";
export { calleeCandidates, isBuiltinCallee } from "./builtin-calls.ts";
export {
  BUILTIN_TILES,
  EFFECT_HANDLERS_SHARED,
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
  BUILTIN_EFFECTS,
  type BuiltinEffect,
  type CapabilityManifest,
  type ManifestResult,
  parseCapabilityManifest,
  STANDARD_CAPABILITIES,
} from "./capabilities.ts";
export { applyRefine, type GenDescData } from "./codegen/emit-type.ts";
export {
  type BindSegment,
  indexSegmentJs,
  isUnwrapStep,
  UNWRAP_SEGMENT,
} from "./codegen/path-segment.ts";
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
export { typeCandidates } from "./stdlib-types.ts";
export {
  collectTimerNames,
  constructorTags,
  qualifierCandidates,
  variantTagsOf,
} from "./symbols.ts";
export {
  A11Y_CODES,
  check,
  type KumikiError,
  ROUTE_SLOT_FIELDS,
  servesNotFound,
} from "./typecheck.ts";

// Public API of @kumikijs/compiler.
export type * from "./ast.ts";
// The name tables themselves stay internal: splitting them three ways is an
// implementation choice (one lowers by full name, one by member, one not at
// all), and freezing that split into the published API would make merging them
// — into a single map carrying arity and lowering kind — a breaking change.
export { calleeCandidates, isBuiltinCallee } from "./builtin-calls.ts";
export { BUILTIN_TILES, TILE_FAMILY, type TileFamily, VALUE_ARG_BUILTINS } from "./builtins.ts";
export {
  type CapabilityManifest,
  type ManifestResult,
  parseCapabilityManifest,
  STANDARD_CAPABILITIES,
} from "./capabilities.ts";
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
export { lex } from "./lexer.ts";
export { ParseError, parse } from "./parser.ts";
export {
  buildDefIndex,
  type DefIndex,
  layerOfDef,
  type Reference,
  type RefLayer,
  referencesIn,
} from "./references.ts";
export { collectTimerNames, variantTagsOf } from "./symbols.ts";
export { check, type KumikiError } from "./typecheck.ts";

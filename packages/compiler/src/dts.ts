// Type generation: from a Kumiki program's `type` / `slot` / `effect` layers,
// emit a TypeScript declaration that types the build-integration boundary —
// notably the host capability providers (the inbound ecosystem seam) so adapters
// get real input/output types instead of `unknown`.
//
// The mapping is structural and matches the runtime representation: primitives,
// records, List (`T[]`), Map (`Record<string, V>`), Set (`Record<string, true>`),
// and the tagged `{ _tag, _0, … }` form of Option / Result / user unions all map
// precisely; refinements/nominals erase to their base. Only genuinely unforeseen
// shapes fall back to `unknown`. Correctness over completeness.

import type { EffectDef, Program, SlotDef, TypeDef, TypeExpr } from "./ast.ts";
import { STANDARD_CAPABILITIES } from "./capabilities.ts";
import { type PrimName, STDLIB_TYPES } from "./stdlib-types.ts";

/**
 * Keyed by `PrimName` rather than `string`, so adding a primitive to the
 * grammar is a compile error here instead of a silent `unknown` in the
 * generated declaration. `File` and `Bytes` are the runtime shapes the
 * capability boundary actually carries; `EffectId` is the opaque handle
 * codegen lowers to a string (`EffectId.none` is `""`).
 */
const PRIM_TS: Record<PrimName, string> = {
  Int: "number",
  Float: "number",
  Time: "number",
  Text: "string",
  Bool: "boolean",
  Unit: "null",
  Bytes: "Uint8Array",
  File: "{ name: string; size: number; type: string }",
  EffectId: "string",
};

// The standard library's domain types (docs/spec/stdlib.md §2.1.3) come from
// the one table the checker also reads. A private list here held only the
// scalar nominals, so `HttpError` and `Route` — the two a capability provider
// is most likely to carry — generated `unknown`.
const STDLIB_BY_NAME: ReadonlyMap<string, TypeDef> = new Map(STDLIB_TYPES.map((t) => [t.name, t]));

type Ctx = {
  /** Kumiki type name → the identifier it is declared under here. */
  userTypes: ReadonlyMap<string, string>;
  expanding: Set<string>;
  /**
   * Type parameters of the declaration being emitted, under the identifiers
   * they were declared with here. Consulted before {@link userTypes}, which is
   * what makes a parameter shadow a type of the same name.
   */
  typeParams: ReadonlyMap<string, string>;
};

function tsOfType(t: TypeExpr, ctx: Ctx): string {
  switch (t.kind) {
    case "TypePrim":
      return PRIM_TS[t.name];
    case "TypeRef": {
      const local = ctx.typeParams.get(t.name) ?? ctx.userTypes.get(t.name);
      if (local) return local;
      const std = STDLIB_BY_NAME.get(t.name);
      // `FormData` names `FormValue`, which names nothing back — but a program
      // that shadows one of these with a self-referential alias would, so the
      // expansion refuses to re-enter a name it is already inside.
      if (!std || ctx.expanding.has(t.name)) return "unknown";
      return tsOfType(std.body, { ...ctx, expanding: new Set([...ctx.expanding, t.name]) });
    }
    case "TypeApp": {
      const arg = (i: number): string =>
        t.args[i] ? tsOfType(t.args[i] as TypeExpr, ctx) : "unknown";
      switch (t.name) {
        case "List":
          return `${wrap(arg(0))}[]`;
        // Map and Set are plain objects at runtime: Map keys are stringified
        // (`Record<string, V>`), and a Set is `{ [key]: true }`.
        case "Map":
          return `Record<string, ${arg(1)}>`;
        case "Set":
          return "Record<string, true>";
        // Option/Result use the runtime tagged representation ({ _tag, _0 }) so
        // a provider's value matches what the runtime actually produces/consumes.
        case "Option":
          return `{ _tag: "Some"; _0: ${arg(0)} } | { _tag: "None" }`;
        case "Result":
          return `{ _tag: "Ok"; _0: ${arg(0)} } | { _tag: "Err"; _0: ${arg(1)} }`;
        case "Tuple":
          return `[${t.args.map((a) => tsOfType(a, ctx)).join(", ")}]`;
        default: {
          // A user generic applied to arguments (`Box(Int)`) — the alias is
          // emitted with its parameters, so the application can name it.
          const declared = ctx.userTypes.get(t.name);
          if (declared) return `${declared}<${t.args.map((a) => tsOfType(a, ctx)).join(", ")}>`;
          const std = STDLIB_BY_NAME.get(t.name);
          if (!std || ctx.expanding.has(t.name)) return "unknown";
          return tsOfType(std.body, { ...ctx, expanding: new Set([...ctx.expanding, t.name]) });
        }
      }
    }
    case "TypeRecord":
      // A Kumiki field name may be kebab-case (`episode-id` on `PanicInfo`),
      // which is not a TypeScript identifier — unquoted it produces a
      // declaration that does not parse.
      return `{ ${t.fields.map((f) => `${tsFieldName(f.name)}: ${tsOfType(f.type, ctx)}`).join("; ")} }`;
    case "TypeUnion":
      // Each variant is a tagged record `{ _tag: "Name"; _0: P0; _1: P1; … }`
      // (positional payloads), matching the runtime variant representation.
      return t.variants.map((v) => variantTs(v.name, v.payloads, ctx)).join(" | ");
    case "TypeNominal":
    case "TypeRefinement":
      // Refinements/nominals erase to their base type in TS.
      return tsOfType(t.inner, ctx);
    default:
      return "unknown";
  }
}

const TS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Quote a field name TypeScript cannot take bare. */
function tsFieldName(name: string): string {
  return TS_IDENT.test(name) ? name : JSON.stringify(name);
}

/**
 * The three names this generator declares itself. They are the file's public
 * surface — a host imports `KumikiProviders` to type its provider table — so
 * they are reserved: a user type of the same name is the side that moves.
 * The `Kumiki` prefix is what keeps that collision rare in the first place;
 * the unqualified `Provider` / `Slots` / `Providers` collided with two of the
 * likelier names a program declares.
 */
const HELPER_PROVIDER = "KumikiProvider";
const HELPER_SLOTS = "KumikiSlots";
const HELPER_PROVIDERS = "KumikiProviders";

/**
 * Names no TypeScript type alias or type parameter may take (`TS2457`), all of
 * which are ordinary Kumiki type names. Seeded into the taken set, so a
 * `type string` is declared as `string_2` rather than as a file that does not
 * parse. `null` is a Kumiki keyword and so cannot be one of these.
 */
const TS_RESERVED_TYPE_NAMES = [
  "any",
  "bigint",
  "boolean",
  "never",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
];

/**
 * A declaration name TypeScript can take. Unlike a field, a type alias cannot
 * be quoted, so a Kumiki name carrying `-` is rewritten the way codegen
 * rewrites a binding — and then made unique, because `a-b` and `a_b` are two
 * Kumiki types and would otherwise become one TypeScript declaration.
 */
function allocTypeName(name: string, taken: Set<string>): string {
  const safe = name.replace(/-/g, "_");
  let candidate = safe;
  for (let n = 2; taken.has(candidate); n++) candidate = `${safe}_${n}`;
  taken.add(candidate);
  return candidate;
}

/** One tagged variant: `{ _tag: "Name" }` or `{ _tag: "Name"; _0: P0; … }`. */
function variantTs(name: string, payloads: TypeExpr[], ctx: Ctx): string {
  if (payloads.length === 0) return `{ _tag: ${JSON.stringify(name)} }`;
  const fields = payloads.map((p, i) => `_${i}: ${tsOfType(p, ctx)}`).join("; ");
  return `{ _tag: ${JSON.stringify(name)}; ${fields} }`;
}

/** Parenthesize a union so `T[]` binds correctly (`(A | null)[]`). */
function wrap(ts: string): string {
  return ts.includes("|") ? `(${ts})` : ts;
}

/**
 * Generate a TypeScript declaration for a Kumiki program's slot/effect/type
 * surface. Returns module source (importing nothing) suitable for writing next
 * to the `.kumiki` file and importing for typed provider authoring.
 */
export function generateDts(program: Program): string {
  const types = program.defs.filter((d): d is TypeDef => d.kind === "TypeDef");
  const slots = program.defs.filter((d): d is SlotDef => d.kind === "SlotDef");
  const effects = program.defs.filter((d): d is EffectDef => d.kind === "EffectDef");
  const taken = new Set([
    HELPER_PROVIDER,
    HELPER_SLOTS,
    HELPER_PROVIDERS,
    ...TS_RESERVED_TYPE_NAMES,
  ]);
  const ctx: Ctx = {
    userTypes: new Map(types.map((t) => [t.name, allocTypeName(t.name, taken)])),
    expanding: new Set(),
    typeParams: new Map(),
  };

  const out: string[] = [];
  out.push("// Auto-generated by @kumikijs/compiler from the .kumiki source. Do not edit.");
  out.push("");
  out.push("/** A typed host implementation for one custom capability. */");
  out.push(`export type ${HELPER_PROVIDER}<In, Out> = (`);
  out.push("  input: In,");
  out.push("  caps: { has(c: string): boolean; provider(c: string): unknown },");
  out.push(") =>");
  out.push("  | { kind: 'ok'; value: Out }");
  out.push("  | { kind: 'err'; value: unknown }");
  out.push("  | Promise<{ kind: 'ok'; value: Out } | { kind: 'err'; value: unknown }>;");
  out.push("");

  for (const t of types) {
    // A type parameter is a Kumiki name too, so it needs the same rewrite —
    // and the same uniquing, against a set seeded from the module's own names:
    // two parameters that lower alike would otherwise become one, and a
    // parameter that lowers onto a declared type's identifier would silently
    // capture every reference to that type inside the alias. The set is a
    // copy, so parameter names — scoped to this alias — do not shift the
    // numbering of the aliases that follow.
    const paramTaken = new Set(taken);
    const typeParams = new Map(t.params.map((p) => [p, allocTypeName(p, paramTaken)]));
    const params = t.params.length > 0 ? `<${[...typeParams.values()].join(", ")}>` : "";
    // The alias body may name its own parameters; without them in scope they
    // resolve to nothing and every generic alias emits `unknown`.
    const body = tsOfType(t.body, { ...ctx, typeParams });
    out.push(`export type ${ctx.userTypes.get(t.name)}${params} = ${body};`);
  }
  if (types.length > 0) out.push("");

  out.push(`export interface ${HELPER_SLOTS} {`);
  // A slot name may be kebab-case, and the emitted `slots` object keys it with
  // that same spelling — so the declaration quotes it rather than renaming it.
  for (const s of slots) out.push(`  ${tsFieldName(s.name)}: ${tsOfType(s.type, ctx)};`);
  out.push("}");
  out.push("");

  // Only custom (non-standard) capabilities need a host provider; standard caps
  // (http.*, nav.*, …) have built-in implementations.
  const custom = effects.filter((e) => !STANDARD_CAPABILITIES.has(e.cap));
  out.push("/** Host implementations for this app's custom capabilities. */");
  out.push(`export interface ${HELPER_PROVIDERS} {`);
  for (const e of custom) {
    const input = tsOfType(e.inType, ctx);
    const output = tsOfType(e.outType, ctx);
    out.push(`  ${JSON.stringify(e.cap)}?: ${HELPER_PROVIDER}<${input}, ${output}>;`);
  }
  out.push("}");
  out.push("");

  return out.join("\n");
}

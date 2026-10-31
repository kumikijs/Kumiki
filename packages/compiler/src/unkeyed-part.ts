import type { TypeEnv } from "./assignable.ts";
import { assertNever, type TypeExpr } from "./ast.ts";
import { expandNamed, GENERIC_SELF_NESTING_LIMIT, typeKey } from "./refinement-positions.ts";
import { BUILTIN_TYPE_CONSTRUCTORS } from "./stdlib-types.ts";

export type UnkeyedPart = {
  readonly part: "Float" | "File" | "Set";
  /** The type is that part itself, rather than holding it somewhere inside. */
  readonly whole: boolean;
};

// The runtime keys a value by `entryKey`: a primitive's `String`, or a structured value's JSON
// with sorted fields. That is `==` but for Float and File. `NaN` is one key yet not `==` to
// itself, and inside a structured value JSON writes `NaN` and both infinities as `null`. A File's
// JSON is its name, size and type, while `==` holds only of a File and itself. A Set's key is its
// `==`, which itself depends on how the Set was built. A Map stores its keys by `entryKey`
// already, so its key and `==` agree there, and only its values are walked.
// A named type is walked through what it stands for, and a part the checker cannot decide is not
// judged. The walk ends because an instantiation met again on its own path is not entered again,
// nor is a generic nested in itself past the limit a type applying itself to a growing argument
// would otherwise run past.
export function unkeyedPart(key: TypeExpr | null, env: TypeEnv): UnkeyedPart | null {
  const walk = (
    t: TypeExpr,
    whole: boolean,
    path: ReadonlySet<string>,
    generics: readonly string[],
  ): UnkeyedPart | null => {
    const parts = (ts: readonly TypeExpr[]): UnkeyedPart | null => {
      for (const x of ts) {
        const found = walk(x, false, path, generics);
        if (found) return found;
      }
      return null;
    };
    switch (t.kind) {
      case "TypePrim":
        return t.name === "Float" || t.name === "File" ? { part: t.name, whole } : null;
      case "TypeRef":
      case "TypeApp": {
        const body = expandNamed(t, env);
        if (body) {
          const at = typeKey(t);
          const depth = generics.filter((n) => n === t.name).length;
          if (path.has(at) || depth >= GENERIC_SELF_NESTING_LIMIT) return null;
          return walk(body, whole, new Set(path).add(at), [...generics, t.name]);
        }
        if (t.kind === "TypeRef") return null;
        if (t.name === "Set") return { part: "Set", whole };
        if (t.name === "Map") return parts(t.args.slice(1));
        return BUILTIN_TYPE_CONSTRUCTORS.has(t.name) ? parts(t.args) : null;
      }
      case "TypeRecord":
        return parts(t.fields.map((f) => f.type));
      case "TypeUnion":
        return parts(t.variants.flatMap((v) => v.payloads));
      case "TypeNominal":
      case "TypeRefinement":
        return walk(t.inner, whole, path, generics);
      default:
        assertNever(t);
        return null;
    }
  };
  return key ? walk(key, true, new Set(), []) : null;
}

import { type TypeEnv, typeToString, unaliasType } from "../assignable.ts";
import { assertNever, type TypeExpr } from "../ast.ts";
import { keyRepresentation } from "../key-representation.ts";
import { expandNamed, GENERIC_SELF_NESTING_LIMIT, typeKey } from "../refinement-positions.ts";
import { FILE_FIELDS } from "../stdlib-types.ts";
import type { NestedRefinements } from "./nested-refinements.ts";

/**
 * What `Decoder.Json(T)` hands its capability as `decode`: a function that answers `undefined`
 * for a value that is a `T` and the first position that is not otherwise (the shape a refused
 * predicate has, so the handlers report both alike). It reads a `Time` position given as text by
 * `Time.parse`'s grammar and writes the instant back in place, so the value it accepted is a `T`.
 */
export type Decoders = {
  readonly decls: string[];
  /** The decoder for `t`, or `undefined` when `t` names nothing it can check. */
  decoderOf(t: TypeExpr): string | undefined;
};

const fail = (kind: string, path = "[]"): string =>
  `{ kind: ${JSON.stringify(kind)}, args: [], path: ${path} }`;

const expected = (t: TypeExpr): string => `expected ${typeToString(t)}`;

const OBJECT = 'v !== null && typeof v === "object" && !Array.isArray(v)';

/** A key that reads back as the text it is stored as, which nothing needs to check. */
const KEY_AS_STORED = "const kk = k;";

export function decoders(env: TypeEnv, refinements: NestedRefinements): Decoders {
  const decls: string[] = [];
  const helpers = new Map<string, string | undefined>();
  let next = 0;
  let timeReader: string | undefined;

  const declare = (fn: string): string => {
    const name = `_dj${next++}`;
    decls.push(`const ${name} = ${fn};`);
    return name;
  };

  const isTime = (t: TypeExpr): boolean => {
    const base = unaliasType(t, env);
    return base?.kind === "TypePrim" && base.name === "Time";
  };

  /** A failure at the value's own position: `undefined` when `check` holds of it. */
  const unless = (check: string, label: string): string =>
    `if (!(${check})) return ${fail(label)};`;

  /** The failure, or `undefined`, at `holder[key]`, as an expression; `undefined` when unchecked. */
  const at = (t: TypeExpr, holder: string, key: string, generics: readonly string[]) => {
    if (isTime(t)) {
      timeReader ??= declare(
        `(o, k, kind) => { const x = o[k]; if (Number.isInteger(x)) return undefined; if (typeof x === "string") { const t = _s.parseTime(x); if (t._tag === "Some") { o[k] = t._0; return undefined; } } return { kind, args: [], path: [] }; }`,
      );
      return `${timeReader}(${holder}, ${key}, ${JSON.stringify(expected(t))})`;
    }
    const check = valueCheck(t, generics);
    return check && `${check}(${holder}[${key}])`;
  };

  /** A step that fails with the position's failure, its path under `step`. */
  const stepInto = (failure: string | undefined, step: string): string[] =>
    failure ? [`if ((f = ${failure})) return { ...f, path: [${step}, ...f.path] };`] : [];

  /** A helper checking a value of type `t`, or `undefined` when `t` is opaque. */
  const valueCheck = (t: TypeExpr, generics: readonly string[]): string | undefined => {
    const key = typeKey(t);
    if (helpers.has(key)) return helpers.get(key);
    const body = expandNamed(t, env);
    if (body && (t.kind === "TypeRef" || t.kind === "TypeApp")) {
      const inner = t.kind === "TypeApp" ? [...generics, t.name] : generics;
      // A generic that applies itself to a growing argument is a new type at every level.
      if (inner.filter((n) => n === t.name).length > GENERIC_SELF_NESTING_LIMIT) return undefined;
      // Declared before its body is lowered, so a type that contains itself calls this helper.
      const name = `_dj${next++}`;
      helpers.set(key, name);
      const steps = shapeOf(body, expected(t), inner) ?? [];
      decls.push(`const ${name} = ${fnOf(steps)};`);
      return name;
    }
    const steps = shapeOf(t, expected(t), generics);
    const name = steps && declare(fnOf(steps));
    helpers.set(key, name);
    return name;
  };

  /** The statements refusing a value `v` that is not of shape `t`, failing as `label`. */
  const shapeOf = (
    t: TypeExpr,
    label: string,
    generics: readonly string[],
  ): string[] | undefined => {
    switch (t.kind) {
      case "TypePrim":
        return primOf(t.name, label, generics);
      case "TypeRef":
      case "TypeApp": {
        if (expandNamed(t, env)) {
          const check = valueCheck(t, generics);
          return check ? [`if ((f = ${check}(v))) return f;`] : undefined;
        }
        return t.kind === "TypeApp" ? containerOf(t, label, generics) : undefined;
      }
      case "TypeNominal":
      case "TypeRefinement":
        return shapeOf(t.inner, label, generics);
      case "TypeRecord":
        return recordOf(t.fields, label, generics);
      case "TypeUnion": {
        const tags = t.variants.map((variant) => `v?._tag === ${JSON.stringify(variant.name)}`);
        return [
          unless(tags.join(" || "), label),
          ...t.variants.flatMap((variant) => {
            const tag = JSON.stringify(variant.name);
            const steps = variant.payloads.flatMap((p, i) =>
              stepInto(
                at(p, "v", JSON.stringify(`_${i}`), generics),
                variant.payloads.length === 1
                  ? `{ variant: ${tag} }`
                  : `{ variant: ${tag}, payload: ${i} }`,
              ),
            );
            return steps.length > 0 ? [`if (v._tag === ${tag}) { ${steps.join(" ")} }`] : [];
          }),
        ];
      }
      default:
        assertNever(t);
        return undefined;
    }
  };

  const recordOf = (
    fields: readonly { name: string; type: TypeExpr }[],
    label: string,
    generics: readonly string[],
  ): string[] => [
    unless(OBJECT, label),
    ...fields.flatMap((field) => {
      const name = JSON.stringify(field.name);
      return [
        `if (!Object.hasOwn(v, ${name})) return ${fail("missing", `[${name}]`)};`,
        ...stepInto(at(field.type, "v", name, generics), name),
      ];
    }),
  ];

  const primOf = (
    name: Extract<TypeExpr, { kind: "TypePrim" }>["name"],
    label: string,
    generics: readonly string[],
  ): string[] => {
    switch (name) {
      case "Int":
      case "Time":
        return [unless("Number.isInteger(v)", label)];
      case "Float":
        return [unless('typeof v === "number"', label)];
      case "Text":
      case "EffectId":
        return [unless('typeof v === "string"', label)];
      case "Bool":
        return [unless('typeof v === "boolean"', label)];
      case "Unit":
        return [unless("v === null", label)];
      case "Bytes":
        return [unless("v instanceof Uint8Array", label)];
      case "File":
        return recordOf(FILE_FIELDS.fields, label, generics);
      default:
        assertNever(name);
        return [];
    }
  };

  /**
   * A Map key or a Set member, stored as the text `_s.entryKey` makes of it: the statements that
   * read `k` into `kk` as `t` reads it back, refusing a key that is no `t` or not stored as one.
   */
  const keyOf = (t: TypeExpr | undefined, step: string, generics: readonly string[]): string[] => {
    if (!t) return [KEY_AS_STORED];
    const refused = `return ${fail(expected(t), `[${step}]`)};`;
    const base = unaliasType(t, env);
    switch (keyRepresentation(t, env)) {
      case "number": {
        const whole = base?.kind === "TypePrim" && base.name !== "Float";
        const holds = whole ? "Number.isInteger(kk) && String(kk) === k" : "String(kk) === k";
        return ["const kk = Number(k);", `if (!(${holds})) ${refused}`];
      }
      case "bool":
        return [`if (k !== "true" && k !== "false") ${refused}`, 'const kk = k === "true";'];
      case "value": {
        const check = valueCheck(t, generics);
        return [
          `let kk; try { kk = JSON.parse(k); } catch { ${refused} }`,
          ...(check
            ? [`if ((f = ${check}(kk))) return { ...f, path: [${step}, ...f.path] };`]
            : []),
          `if (_s.entryKey(kk) !== k) ${refused}`,
        ];
      }
      default:
        return [KEY_AS_STORED];
    }
  };

  const containerOf = (
    t: TypeExpr & { kind: "TypeApp" },
    label: string,
    generics: readonly string[],
  ): string[] | undefined => {
    const [a0, a1] = t.args;
    /** A loop over the entries, left out when it would check nothing. */
    const loop = (
      head: string,
      key: readonly string[],
      entry: string | undefined,
      step: string,
    ) => {
      const checks = stepInto(entry, step);
      if (checks.length === 0 && key.every((s) => s === KEY_AS_STORED)) return [];
      return [`for (${head}) { ${[...key, ...checks].join(" ")} }`];
    };
    const sub = (x: TypeExpr | undefined, holder: string, key: string) =>
      x ? at(x, holder, key, generics) : undefined;
    const tagged = (tags: readonly (TypeExpr | undefined)[], names: readonly string[]) => [
      unless(names.map((n) => `v?._tag === ${JSON.stringify(n)}`).join(" || "), label),
      ...names.flatMap((n, i) => {
        const tag = JSON.stringify(n);
        const steps = stepInto(sub(tags[i], "v", '"_0"'), `{ variant: ${tag} }`);
        return steps.length > 0 ? [`if (v._tag === ${tag}) { ${steps.join(" ")} }`] : [];
      }),
    ];
    switch (t.name) {
      case "List":
        return [
          unless("Array.isArray(v)", label),
          ...loop("let i = 0; i < v.length; i++", [], sub(a0, "v", "i"), "i"),
        ];
      case "Tuple":
        return [
          unless(`Array.isArray(v) && v.length === ${t.args.length}`, label),
          ...t.args.flatMap((x, i) => stepInto(sub(x, "v", String(i)), String(i))),
        ];
      case "Option":
        return tagged([a0, undefined], ["Some", "None"]);
      case "Result":
        return tagged([a0, a1], ["Ok", "Err"]);
      case "Map":
        return [
          unless(OBJECT, label),
          ...loop(
            "const k of Object.keys(v)",
            keyOf(a0, "{ key: k }", generics),
            sub(a1, "v", "k"),
            "{ entry: kk }",
          ),
        ];
      case "Set":
        return [
          unless(OBJECT, label),
          `for (const k of Object.keys(v)) { ${[
            `if (v[k] !== true) return ${fail(label)};`,
            ...keyOf(a0, "{ member: k }", generics),
          ].join(" ")} }`,
        ];
      default:
        return undefined;
    }
  };

  const answered = new Map<string, string | undefined>();

  return {
    decls,
    decoderOf: (t) => {
      const key = typeKey(t);
      if (answered.has(key)) return answered.get(key);
      const shape = valueCheck(t, []);
      const predicates = refinements.explainerOf(t);
      const name =
        shape && predicates
          ? declare(`(v) => ${shape}(v) ?? ${predicates}(v)`)
          : (shape ?? predicates);
      answered.set(key, name);
      return name;
    },
  };
}

/** A check over `v` from its statements; `f` holds the failure a nested check answered. */
function fnOf(steps: readonly string[]): string {
  if (steps.length === 0) return "(v) => undefined";
  const body = steps.join(" ");
  const local = body.includes("(f = ") ? "let f; " : "";
  return `(v) => { ${local}${body} return undefined; }`;
}

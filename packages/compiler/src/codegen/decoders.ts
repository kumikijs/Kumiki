import { VARIANT_TAG_FIELD } from "@kumikijs/runtime/variant-tag";
import { type TypeEnv, typeToString, unaliasType } from "../assignable.ts";
import { assertNever, type TypeExpr } from "../ast.ts";
import { keyRepresentation } from "../key-representation.ts";
import { expandNamed, GENERIC_SELF_NESTING_LIMIT, typeKey } from "../refinement-positions.ts";
import { FILE_FIELDS } from "../stdlib-types.ts";
import type { NestedRefinements } from "./nested-refinements.ts";

/** The checks a module's `Decoder.Json(T)`s lower to, and the declarations they need. */
export type Decoders = {
  readonly decls: string[];
  /**
   * What `Decoder.Json(t)` hands its capability as `decode`, or `undefined` when `t` names nothing
   * it can check: a function that answers `undefined` for a value that is a `t`, and otherwise the
   * first position that is not (the shape a refused predicate has, so the handlers report both
   * alike). It reads a `Time` position given as text by `Time.parse`'s grammar and writes the
   * instant back in place. It removes each key a record holds beyond its fields, and a variant
   * beyond its tag and payloads, so the value it accepted holds a `t` and nothing else.
   */
  decoderOf(t: TypeExpr): string | undefined;
};

const fail = (kind: string, path = "[]"): string =>
  `{ kind: ${JSON.stringify(kind)}, args: [], path: ${path} }`;

const expected = (t: TypeExpr): string => `expected ${typeToString(t)}`;

/**
 * A number an `Int` or a `Time` holds: a whole one, or one that is not finite, which an `Int`
 * computed from a `Float` can be (`(-1.0).sqrt.floor` is `NaN`) and storage keeps.
 */
const whole = (x: string): string =>
  `typeof ${x} === "number" && (Number.isInteger(${x}) || !Number.isFinite(${x}))`;

/**
 * A key taken as the text it is stored as: a `Text` key needs no check, and a key with no
 * representation has none to make.
 */
const KEY_AS_STORED = "const kk = k;";

/** The primitives a structured key's JSON holds as `null` when they are not finite. */
const NUMERIC_IN_KEY: ReadonlySet<string> = new Set(["Int", "Float", "Time"]);

export function decoders(env: TypeEnv, refinements: NestedRefinements): Decoders {
  const decls: string[] = [];
  let next = 0;
  let timeReader: string | undefined;
  let plainObject: string | undefined;

  const declare = (fn: string): string => {
    const name = `_dj${next++}`;
    decls.push(`const ${name} = ${fn};`);
    return name;
  };

  const isTime = (t: TypeExpr): boolean => {
    const base = unaliasType(t, env);
    return base?.kind === "TypePrim" && base.name === "Time";
  };

  // A record, a Map and a Set are objects JSON or a structured clone makes, never a `Uint8Array`,
  // a `Date` or a JS `Map` that a storage tag or an IndexedDB clone holds. Read off the prototype
  // chain rather than `Object.prototype`, so an object made in another realm is still plain.
  const plain = (): string =>
    (plainObject ??= declare(
      '(v) => { if (v === null || typeof v !== "object") return false; const p = Object.getPrototypeOf(v); return p === null || Object.getPrototypeOf(p) === null; }',
    ));

  /** A statement returning the failure at `v`'s own position when `check` does not hold. */
  const unless = (check: string, label: string): string =>
    `if (!(${check})) return ${fail(label)};`;

  /** A statement removing each key of `v` that `keys` does not name. */
  const keepOnly = (keys: readonly string[]): string => {
    const other = keys.map((k) => `k !== ${JSON.stringify(k)}`).join(" && ") || "true";
    return `for (const k of Object.keys(v)) if (${other}) delete v[k];`;
  };

  /** The keys a variant with `payloads` payloads is held in: its tag, then `_0`, `_1`, …. */
  const variantKeys = (payloads: number): string[] => [
    VARIANT_TAG_FIELD,
    ...Array.from({ length: payloads }, (_, i) => `_${i}`),
  ];

  /** A step that fails with the position's failure, its path under `step`. */
  const stepInto = (failure: string | undefined, step: string): string[] =>
    failure ? [`if ((f = ${failure})) return { ...f, path: [${step}, ...f.path] };`] : [];

  /**
   * The checks of one reading of a type: of a value as the program holds it, or, `inKey`, of a
   * structured Map key or Set member as `_s.entryKey` stores it, where a number that is not finite
   * is `null`, a `Bytes` is a plain object, and a `Time` is the number it holds.
   */
  const walker = (inKey: boolean) => {
    const helpers = new Map<string, string | undefined>();

    /** An expression for the failure at `holder[key]`, or `undefined` when it needs no check. */
    const at = (t: TypeExpr, holder: string, key: string, generics: readonly string[]) => {
      if (!inKey && isTime(t)) {
        timeReader ??= declare(
          `(o, k, kind) => { const x = o[k]; if (${whole("x")}) return undefined; if (typeof x === "string") { const t = _s.parseTime(x); if (t.${VARIANT_TAG_FIELD} === "Some") { o[k] = t._0; return undefined; } } return { kind, args: [], path: [] }; }`,
        );
        return `${timeReader}(${holder}, ${key}, ${JSON.stringify(expected(t))})`;
      }
      const check = valueCheck(t, generics);
      return check && `${check}(${holder}[${key}])`;
    };

    /** A helper checking a value of type `t`, or `undefined` when `t` is opaque. */
    const valueCheck = (t: TypeExpr, generics: readonly string[]): string | undefined => {
      const key = typeKey(t);
      if (helpers.has(key)) return helpers.get(key);
      const body = expandNamed(t, env);
      if (body && (t.kind === "TypeRef" || t.kind === "TypeApp")) {
        const inner = t.kind === "TypeApp" ? [...generics, t.name] : generics;
        // A generic that applies itself to a growing argument is a new type at every level, so
        // past the limit the position goes unchecked.
        if (inner.filter((n) => n === t.name).length > GENERIC_SELF_NESTING_LIMIT) return undefined;
        // Named before its body is lowered, so a type that contains itself calls this helper.
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
          const tags = t.variants.map(
            (variant) => `v?.${VARIANT_TAG_FIELD} === ${JSON.stringify(variant.name)}`,
          );
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
              const prune = keepOnly(variantKeys(variant.payloads.length));
              return [`if (v.${VARIANT_TAG_FIELD} === ${tag}) { ${[...steps, prune].join(" ")} }`];
            }),
          ];
        }
        default:
          assertNever(t);
          return undefined;
      }
    };

    /** A record's checks, then the removal of each key it neither declares nor `also` keeps. */
    const recordOf = (
      fields: readonly { name: string; type: TypeExpr }[],
      label: string,
      generics: readonly string[],
      also: readonly string[] = [],
    ): string[] => [
      unless(`${plain()}(v)`, label),
      ...fields.flatMap((field) => {
        const name = JSON.stringify(field.name);
        return [
          `if (!Object.hasOwn(v, ${name})) return ${fail("missing", `[${name}]`)};`,
          ...stepInto(at(field.type, "v", name, generics), name),
        ];
      }),
      keepOnly([...fields.map((field) => field.name), ...also]),
    ];

    const primOf = (
      name: Extract<TypeExpr, { kind: "TypePrim" }>["name"],
      label: string,
      generics: readonly string[],
    ): string[] => {
      const number = (check: string) =>
        unless(inKey && NUMERIC_IN_KEY.has(name) ? `v === null || (${check})` : check, label);
      switch (name) {
        case "Int":
        case "Time":
          return [number(whole("v"))];
        case "Float":
          return [number('typeof v === "number"')];
        case "Text":
          return [unless('typeof v === "string"', label)];
        case "Bool":
          return [unless('typeof v === "boolean"', label)];
        case "Unit":
          return [unless("v === null", label)];
        case "Bytes":
          return [unless(inKey ? `${plain()}(v)` : "v instanceof Uint8Array", label)];
        // `_file` is the runtime's handle on the picked file, held beside the fields.
        case "File":
          return recordOf(FILE_FIELDS.fields, label, generics, ["_file"]);
        // JSON holds no decoder or effect id, and the checker refuses either in the type a
        // `Decoder.Json(T)` reads.
        case "EffectId":
        case "Decoder":
          return [`return ${fail(label)};`];
        default:
          assertNever(name);
          return [];
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
        unless(
          names.map((n) => `v?.${VARIANT_TAG_FIELD} === ${JSON.stringify(n)}`).join(" || "),
          label,
        ),
        ...names.map((n, i) => {
          const tag = JSON.stringify(n);
          const steps = stepInto(sub(tags[i], "v", '"_0"'), `{ variant: ${tag} }`);
          const prune = keepOnly(variantKeys(tags[i] ? 1 : 0));
          return `if (v.${VARIANT_TAG_FIELD} === ${tag}) { ${[...steps, prune].join(" ")} }`;
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
            unless(`${plain()}(v)`, label),
            ...loop(
              "const k of Object.keys(v)",
              keyOf(a0, "{ key: k }", generics),
              sub(a1, "v", "k"),
              "{ entry: kk }",
            ),
          ];
        case "Set":
          return [
            unless(`${plain()}(v)`, label),
            `for (const k of Object.keys(v)) { ${[
              `if (v[k] !== true) return ${fail(label)};`,
              ...keyOf(a0, "{ member: k }", generics),
            ].join(" ")} }`,
          ];
        default:
          return undefined;
      }
    };

    return valueCheck;
  };

  const held = walker(false);
  const stored = walker(true);

  /**
   * A Map key or a Set member, stored as the text `_s.entryKey` makes of it: the statements that
   * read `k` into `kk` as `t` reads it back, refusing a key that is no `t` or not stored as one.
   */
  function keyOf(t: TypeExpr | undefined, step: string, generics: readonly string[]): string[] {
    if (!t) return [KEY_AS_STORED];
    const refused = `return ${fail(expected(t), `[${step}]`)};`;
    const base = unaliasType(t, env);
    const prim = base?.kind === "TypePrim" ? base.name : undefined;
    const representation = keyRepresentation(t, env);
    if (representation === "number") {
      const holds = prim === "Float" ? "String(kk) === k" : `(${whole("kk")}) && String(kk) === k`;
      return ["const kk = Number(k);", `if (!(${holds})) ${refused}`];
    }
    if (representation === "bool") {
      return [`if (k !== "true" && k !== "false") ${refused}`, 'const kk = k === "true";'];
    }
    if (prim === "Unit") return [`if (k !== "null") ${refused}`, "const kk = null;"];
    if (representation === "value" || prim === "Bytes" || prim === "File") {
      const check = stored(t, generics);
      return [
        `let kk; try { kk = JSON.parse(k); } catch { ${refused} }`,
        ...(check ? [`if ((f = ${check}(kk))) return { ...f, path: [${step}, ...f.path] };`] : []),
        `if (_s.entryKey(kk) !== k) ${refused}`,
      ];
    }
    return [KEY_AS_STORED];
  }

  const answered = new Map<string, string | undefined>();

  return {
    decls,
    decoderOf: (t) => {
      const key = typeKey(t);
      if (answered.has(key)) return answered.get(key);
      const shape = held(t, []);
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

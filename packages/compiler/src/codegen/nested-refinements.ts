import type { TypeEnv } from "../assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "../ast.ts";
import { keyRepresentation } from "../key-representation.ts";
import {
  containerPositions,
  expandNamed,
  firstRefinement,
  GENERIC_SELF_NESTING_LIMIT,
  scanPositions,
  typeKey,
} from "../refinement-positions.ts";
import { refinementBodyJs } from "../refinements.ts";
import { fieldKey } from "./context.ts";

/** A failure as the runtime reads it back: see `RefinementFailure` in runtime `core/refinement.ts`. */
const FAIL = (r: Refinement): string =>
  `{ kind: ${JSON.stringify(r.pred)}, args: ${JSON.stringify(r.args)}, path: [] }`;

export type NestedRefinements = {
  readonly decls: string[];
  explainerOf(t: TypeExpr): string | undefined;
};

export function nestedRefinements(env: TypeEnv): NestedRefinements {
  const decls: string[] = [];
  const helpers = new Map<string, string>();
  let next = 0;

  const carries = (t: TypeExpr): boolean => scanPositions(t, env).carries;

  const at = (stepJs: string, check: string, valueJs: string, onPath?: string): string => {
    const found = `return { ...f, path: [${stepJs}, ...f.path] };`;
    return onPath === undefined
      ? `if ((f = ${named$(check)}(${valueJs}))) ${found}`
      : `if ((!o?.length || ${onPath}) && (f = ${named$(check)}(${valueJs}, o?.slice(1)))) ${found}`;
  };

  /** `check` as a helper's name, declaring it first when it is an arrow. */
  const named$ = (check: string): string => (isHelper(check) ? check : hoist(check));

  /** Refuse a value of the wrong shape against the first predicate `t`'s positions carry. */
  const walk = (t: TypeExpr, shape: string, steps: string[]): string | undefined => {
    if (steps.length === 0) return undefined;
    const r = firstRefinement(t, env);
    return fnOf(r ? [`if (!(${shape})) return ${FAIL(r)};`, ...steps] : steps);
  };

  const explain = (t: TypeExpr, generics: readonly string[]): string | undefined => {
    if (!carries(t)) return undefined;
    switch (t.kind) {
      case "TypePrim":
        return undefined;
      case "TypeRef":
        return named(t, generics);
      case "TypeApp":
        return expandNamed(t, env) ? named(t, generics) : containerJs(t, generics);
      case "TypeNominal":
      case "TypeRefinement":
        return chainJs(t, generics);
      case "TypeRecord":
        return walk(
          t,
          'v !== null && typeof v === "object" && !Array.isArray(v)',
          t.fields.flatMap((field) => {
            const check = explain(field.type, generics);
            const name = JSON.stringify(field.name);
            return check ? [at(name, check, `v[${fieldKey(field.name)}]`, `o[0] === ${name}`)] : [];
          }),
        );
      case "TypeUnion":
        return walk(
          t,
          t.variants.map((variant) => `v?._tag === ${JSON.stringify(variant.name)}`).join(" || "),
          t.variants.flatMap((variant) =>
            variant.payloads.flatMap((p, i) => {
              const check = explain(p, generics);
              if (!check) return [];
              const tag = JSON.stringify(variant.name);
              const step =
                variant.payloads.length === 1
                  ? `{ variant: ${tag} }`
                  : `{ variant: ${tag}, payload: ${i} }`;
              return [
                `if (v._tag === ${tag}) { ${at(step, check, `v[${JSON.stringify(`_${i}`)}]`)} }`,
              ];
            }),
          ),
        );
      default:
        assertNever(t);
        return undefined;
    }
  };

  /** A named type or applied program generic: one helper per key, shared by every occurrence. */
  const named = (
    t: TypeExpr & { kind: "TypeRef" | "TypeApp" },
    generics: readonly string[],
  ): string | undefined => {
    const body = expandNamed(t, env);
    if (!body) return undefined;
    const key = typeKey(t);
    const known = helpers.get(key);
    if (known) return known;
    const inner = entering(t, generics);
    const name = `_rq${next++}`;
    helpers.set(key, name);
    const fn = chainJs(body, inner);
    if (fn === undefined) {
      throw new Error(`nested refinement lowering: "${t.name}" carries a refinement with no walk`);
    }
    decls.push(`const ${name} = ${isHelper(fn) ? `(v, o) => ${fn}(v, o)` : fn};`);
    return name;
  };

  const entering = (
    t: TypeExpr & { kind: "TypeRef" | "TypeApp" },
    generics: readonly string[],
  ): readonly string[] => {
    const inner = t.kind === "TypeApp" ? [...generics, t.name] : generics;
    if (inner.filter((n) => n === t.name).length > GENERIC_SELF_NESTING_LIMIT) {
      throw new Error(
        `nested refinement lowering: "${t.name}" nests inside itself past the limit, which the checker reports as E0803 before codegen runs`,
      );
    }
    return inner;
  };

  // One check for the whole chain: a helper per step would be a frame per step at runtime as
  // well as here, and nothing bounds how long a chain is.
  const chainJs = (t: TypeExpr, generics: readonly string[]): string | undefined => {
    const outermostFirst: Refinement[] = [];
    const entered = new Set<string>();
    let inner = generics;
    let cur = t;
    for (;;) {
      if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
        if (cur.refinement) outermostFirst.push(cur.refinement);
        cur = cur.inner;
        continue;
      }
      if (cur.kind !== "TypeRef" && cur.kind !== "TypeApp") break;
      const body = expandNamed(cur, env);
      if (!body) break;
      const key = typeKey(cur);
      if (helpers.has(key) || entered.has(key)) break;
      entered.add(key);
      inner = entering(cur, inner);
      cur = body;
    }
    const end = explain(cur, inner);
    if (outermostFirst.length === 0) return end;
    const steps: string[] = [];
    if (end) steps.push(`if ((f = ${named$(end)}(v, o))) return f;`);
    for (const r of outermostFirst.reverse()) {
      const body = refinementBodyJs(r);
      if (body) steps.push(`if (!(${body})) return ${FAIL(r)};`);
    }
    return fnOf(steps);
  };

  const keyJs = (k: TypeExpr | undefined, js: string): string => {
    switch (keyRepresentation(k ?? null, env)) {
      case "number":
        return `(typeof ${js} === "number" ? ${js} : Number(${js}))`;
      case "bool":
        return `(${js} === true || ${js} === "true")`;
      case "value":
        return `JSON.parse(${js})`;
      default:
        return js;
    }
  };

  const containerJs = (
    t: TypeExpr & { kind: "TypeApp" },
    generics: readonly string[],
  ): string | undefined => {
    const positions = containerPositions(t, env);
    const [a0, a1] = t.args;
    const sub = (x: TypeExpr | undefined): string | undefined =>
      x && positions.includes(x) ? explain(x, generics) : undefined;
    const tagged = (tag: string, x: TypeExpr | undefined): string[] => {
      const check = sub(x);
      const name = JSON.stringify(tag);
      const onPath = tag === "Err" ? "false" : "o[0]?.get === true";
      return check
        ? [`if (v._tag === ${name}) { ${at(`{ variant: ${name} }`, check, "v._0", onPath)} }`]
        : [];
    };
    const object = 'v !== null && typeof v === "object"';
    switch (t.name) {
      case "List": {
        const check = sub(a0);
        return walk(
          t,
          "Array.isArray(v)",
          check ? [`for (const [i, e] of v.entries()) { ${at("i", check, "e")} }`] : [],
        );
      }
      case "Set": {
        const check = sub(a0);
        const members = `Array.isArray(v) ? v : Object.entries(v).map(([k, e]) => (e === true ? ${keyJs(a0, "k")} : e))`;
        return walk(
          t,
          object,
          check ? [`for (const m of ${members}) { ${at("{ member: m }", check, "m")} }`] : [],
        );
      }
      case "Map": {
        const steps: string[] = [];
        const key = sub(a0);
        if (key) {
          const read = keyJs(a0, "k");
          const bind = read === "k" ? "" : `const kk = ${read}; `;
          const kk = read === "k" ? "k" : "kk";
          steps.push(`for (const k of Object.keys(v)) { ${bind}${at(`{ key: ${kk} }`, key, kk)} }`);
        }
        const val = sub(a1);
        if (val) {
          steps.push(
            `for (const [k, e] of Object.entries(v)) { ${at(`{ entry: ${keyJs(a0, "k")} }`, val, "e")} }`,
          );
        }
        return walk(t, `${object} && !Array.isArray(v)`, steps);
      }
      case "Option":
        return walk(t, 'v?._tag === "Some" || v?._tag === "None"', tagged("Some", a0));
      case "Result":
        return walk(t, 'v?._tag === "Ok" || v?._tag === "Err"', [
          ...tagged("Ok", a0),
          ...tagged("Err", a1),
        ]);
      case "Tuple":
        return walk(
          t,
          "Array.isArray(v)",
          t.args.flatMap((x, i) => {
            const check = sub(x);
            return check ? [at(String(i), check, `v[${i}]`)] : [];
          }),
        );
      default:
        return undefined;
    }
  };

  const hoist = (fn: string): string => {
    const name = `_rq${next++}`;
    decls.push(`const ${name} = ${fn};`);
    return name;
  };

  const answered = new Map<string, string | undefined>();

  return {
    decls,
    explainerOf: (t) => {
      const key = typeKey(t);
      if (answered.has(key)) return answered.get(key);
      const fn = explain(t, []);
      const name = fn === undefined || isHelper(fn) ? fn : hoist(fn);
      answered.set(key, name);
      return name;
    },
  };
}

/** A statement-bodied explain function, or `undefined` when it has no steps. */
function fnOf(steps: string[]): string | undefined {
  if (steps.length === 0) return undefined;
  const body = steps.join(" ");
  const local = body.includes("(f = ") ? "let f; " : "";
  return `(v, o) => { ${local}${body} return undefined; }`;
}

const isHelper = (fn: string): boolean => /^_rq\d+$/.test(fn);

import { paramSubstitution, substituteType, unaliasType } from "../assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "../ast.ts";
import { refinementBodyJs } from "../refinements.ts";
import type { GenCtx } from "./context.ts";

/**
 * The refinements a type carries at every position a value of it has, not only
 * on the type itself (spec/language.md §1.3.3: every predicate is a check the
 * value passes on its way into the slot).
 *
 * `refinementsOf` answers for the type's own chain and stops at a structural
 * type, because nothing written inside a record is a refinement *of the
 * record*. It is still a refinement of the value the record holds, and a write
 * that puts `"nope"` in `form.email` on `{email: Text where email}` is a write
 * of a value the slot's type refuses (#444). This module lowers that: one
 * function per type that answers, for a value, the first predicate it fails —
 * with the path to where it failed — or `undefined`.
 *
 * The positions are a record's fields, a union variant's payloads, and a
 * container's elements (`List` / `Set` elements, `Map` keys and values,
 * `Option`'s `Some`, `Result`'s `Ok` / `Err`, a `Tuple`'s members) — the three
 * shapes fail the same way, so they are one walk. A type that carries nothing
 * at any of them gets no function at all, which is what keeps a slot with no
 * refinement ungated.
 *
 * A named type (or an applied generic) is lowered once into a module-level
 * helper and referenced from everywhere it occurs, which is what makes a
 * recursive type (`type Tree = {label: Text where nonempty, kids: List(Tree)}`)
 * a function that calls itself rather than a walk that never ends. The value
 * is finite, so the check is.
 */

/** A failure as the runtime reads it back: see `RefinementFailure` in core.ts. */
const FAIL = (r: Refinement): string =>
  `{ kind: ${JSON.stringify(r.pred)}, args: ${JSON.stringify(r.args)}, path: "" }`;

/**
 * How many named types deep one expansion may nest before the walk stops. Only
 * a generic that applies itself to a *growing* argument (`type T(A) = {x:
 * T(List(A))}`) reaches it: every other recursion re-enters a key already
 * being lowered and becomes a call.
 */
const MAX_DEPTH = 32;

/** The builtin containers whose elements are positions of the value. */
const CONTAINERS = new Set(["List", "Set", "Map", "Option", "Result", "Tuple"]);

/** A key for a type expression, positions stripped, refinements kept. */
const keyOf = (t: TypeExpr): string => JSON.stringify(t, (k, v) => (k === "pos" ? undefined : v));

export type NestedRefinements = {
  /**
   * The module-level helper declarations the explainers handed out so far
   * refer to. Each is a `const` arrow that only calls the others when it runs,
   * so their order among themselves does not matter; they have to precede
   * the first call, which the slot table is not.
   */
  readonly decls: string[];
  /**
   * Does a value of `t` carry a refinement anywhere below `t`'s own chain —
   * which is what decides that a slot is gated by an explainer rather than by
   * the chain's predicates alone.
   */
  hasNested(t: TypeExpr): boolean;
  /**
   * The name of a module-level function answering the first predicate a value
   * of `t` fails, with its path, or `undefined` when `t` carries none at all.
   */
  explainerOf(t: TypeExpr): string | undefined;
};

export function nestedRefinements(gen: GenCtx): NestedRefinements {
  const decls: string[] = [];
  const helpers = new Map<string, string>();
  let next = 0;

  /** The body a named type or applied program generic stands for, if any. */
  const expand = (t: TypeExpr): TypeExpr | undefined => {
    if (t.kind !== "TypeRef" && t.kind !== "TypeApp") return undefined;
    const def = gen.types.get(t.name);
    if (!def) return undefined;
    return t.kind === "TypeApp"
      ? substituteType(def.body, paramSubstitution(def.params, t.args))
      : def.body;
  };

  /** Does any position of `t` carry a refinement? Reachability, so a cycle is `false`. */
  const carries = (t: TypeExpr, visiting: ReadonlySet<string>): boolean => {
    switch (t.kind) {
      case "TypePrim":
        return false;
      case "TypeRef":
      case "TypeApp": {
        const body = expand(t);
        if (body) {
          const key = keyOf(t);
          if (visiting.has(key) || visiting.size >= MAX_DEPTH) return false;
          return carries(body, new Set([...visiting, key]));
        }
        return t.kind === "TypeApp" && CONTAINERS.has(t.name)
          ? t.args.some((a) => carries(a, visiting))
          : false;
      }
      case "TypeNominal":
      case "TypeRefinement":
        return t.refinement !== undefined || carries(t.inner, visiting);
      case "TypeRecord":
        return t.fields.some((f) => carries(f.type, visiting));
      case "TypeUnion":
        return t.variants.some((v) => v.payloads.some((p) => carries(p, visiting)));
      default:
        assertNever(t);
        return false;
    }
  };

  /** One step into a position: `f` is the failure found there. */
  const at = (pathJs: string, check: string, valueJs: string): string =>
    `if ((f = ${call(check, valueJs)})) return { ...f, path: ${pathJs} + f.path };`;

  const explain = (t: TypeExpr, depth: number): string | undefined => {
    if (!carries(t, new Set())) return undefined;
    switch (t.kind) {
      case "TypePrim":
        return undefined;
      case "TypeRef":
      case "TypeApp": {
        const body = expand(t);
        if (body) {
          const key = keyOf(t);
          const known = helpers.get(key);
          if (known) return known;
          if (depth >= MAX_DEPTH) return undefined;
          const name = `_rq${next++}`;
          helpers.set(key, name);
          const fn = explain(body, depth + 1) ?? "(_v) => undefined";
          decls.push(`const ${name} = ${fn};`);
          return name;
        }
        return containerJs(t as TypeExpr & { kind: "TypeApp" }, depth);
      }
      case "TypeNominal":
      case "TypeRefinement": {
        // Base outward (§1.3.1): whatever the inner type refuses is named
        // before the predicate written on top of it.
        const steps: string[] = [];
        const inner = explain(t.inner, depth);
        if (inner) steps.push(`if ((f = ${call(inner, "v")})) return f;`);
        const r = t.refinement;
        const body = r ? refinementBodyJs(r) : undefined;
        if (r && body) steps.push(`if (!(${body})) return ${FAIL(r)};`);
        return fnOf(steps);
      }
      case "TypeRecord":
        return fnOf(
          t.fields.flatMap((field) => {
            const check = explain(field.type, depth);
            const name = JSON.stringify(field.name);
            return check ? [at(JSON.stringify(`.${field.name}`), check, `v?.[${name}]`)] : [];
          }),
        );
      case "TypeUnion":
        return fnOf(
          t.variants.flatMap((variant) =>
            variant.payloads.flatMap((p, i) => {
              const check = explain(p, depth);
              if (!check) return [];
              const path =
                variant.payloads.length === 1 ? `.${variant.name}` : `.${variant.name}[${i}]`;
              return [
                `if (v?._tag === ${JSON.stringify(variant.name)}) { ${at(JSON.stringify(path), check, `v[${JSON.stringify(`_${i}`)}]`)} }`,
              ];
            }),
          ),
        );
      default:
        assertNever(t);
        return undefined;
    }
  };

  /** `k` as the key type reads it: a number when the type is one over a number. */
  const keyJs = (k: TypeExpr | undefined): string => {
    const base = k ? unaliasType(k, gen) : null;
    const numeric =
      base?.kind === "TypePrim" &&
      (base.name === "Int" || base.name === "Float" || base.name === "Time");
    return numeric ? '(typeof k === "number" ? k : Number(k))' : "k";
  };

  const containerJs = (t: TypeExpr & { kind: "TypeApp" }, depth: number): string | undefined => {
    const [a0, a1] = t.args;
    const sub = (x: TypeExpr | undefined): string | undefined =>
      x ? explain(x, depth) : undefined;
    const tagged = (tag: string, x: TypeExpr | undefined): string[] => {
      const check = sub(x);
      return check
        ? [
            `if (v?._tag === ${JSON.stringify(tag)}) { ${at(JSON.stringify(`.${tag}`), check, "v._0")} }`,
          ]
        : [];
    };
    switch (t.name) {
      case "List": {
        const check = sub(a0);
        return check
          ? fnOf([
              `for (const [i, e] of [...(v ?? [])].entries()) { ${at('"[" + i + "]"', check, "e")} }`,
            ])
          : undefined;
      }
      // A set and a map's keys are an object's keys at runtime (`setToggle`,
      // a map literal), so they are strings; a member over a number is read
      // back as one before its predicate sees it.
      case "Set": {
        const check = sub(a0);
        return check
          ? fnOf([
              `for (const k of Array.isArray(v) ? v : Object.keys(v ?? {})) { ${at('"{" + JSON.stringify(k) + "}"', check, keyJs(a0))} }`,
            ])
          : undefined;
      }
      case "Map": {
        const steps: string[] = [];
        const key = sub(a0);
        if (key) {
          steps.push(
            `for (const k of Object.keys(v ?? {})) { ${at('".keys[" + JSON.stringify(k) + "]"', key, keyJs(a0))} }`,
          );
        }
        const val = sub(a1);
        if (val) {
          steps.push(
            `for (const [k, e] of Object.entries(v ?? {})) { ${at('"[" + JSON.stringify(k) + "]"', val, "e")} }`,
          );
        }
        return fnOf(steps);
      }
      case "Option":
        return fnOf(tagged("Some", a0));
      case "Result":
        return fnOf([...tagged("Ok", a0), ...tagged("Err", a1)]);
      case "Tuple":
        return fnOf(
          t.args.flatMap((x, i) => {
            const check = sub(x);
            return check ? [at(JSON.stringify(`[${i}]`), check, `v?.[${i}]`)] : [];
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

  return {
    decls,
    // `unaliasType` is the type's structural body with every wrapper stripped
    // and every generic instantiated, so what it carries sits below the chain.
    hasNested: (t) => {
      const body = unaliasType(t, gen);
      return body !== null && carries(body, new Set());
    },
    explainerOf: (t) => {
      const fn = explain(t, 0);
      return fn === undefined || /^_rq\d+$/.test(fn) ? fn : hoist(fn);
    },
  };
}

/** A statement-bodied explain function, or `undefined` when it has no steps. */
function fnOf(steps: string[]): string | undefined {
  if (steps.length === 0) return undefined;
  const body = steps.join(" ");
  const local = body.includes("(f = ") ? "let f; " : "";
  return `(v) => { ${local}${body} return undefined; }`;
}

/** Apply an explainer — a helper's name, or an arrow that needs its parentheses. */
const call = (check: string, valueJs: string): string =>
  /^_rq\d+$/.test(check) ? `${check}(${valueJs})` : `(${check})(${valueJs})`;

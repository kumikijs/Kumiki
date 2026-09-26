import { type TypeEnv, unaliasType } from "../assignable.ts";
import { assertNever, type Refinement, type TypeExpr } from "../ast.ts";
import {
  containerPositions,
  expandNamed,
  firstRefinement,
  GENERIC_SELF_NESTING_LIMIT,
  scanPositions,
  typeKey,
} from "../refinement-positions.ts";
import { refinementBodyJs } from "../refinements.ts";

/**
 * The refinements a type carries at every position a value of it has, not only
 * on the type itself (spec/language.md §1.3.3: every predicate is a check the
 * value passes on its way into the slot).
 *
 * `refinementsOf` answers for the type's own chain and stops at a structural
 * type, because nothing written inside a record is a refinement *of the
 * record*. It is still a refinement of the value the record holds, and a write
 * that puts `"nope"` in `form.email` on `{email: Text where email}` is a write
 * of a value the slot's type refuses. This module lowers that: one function
 * per type that answers, for a value, the first predicate it fails — with the
 * path to where it failed — or `undefined`.
 *
 * Which parts of a value are positions, and whether a type carries anything at
 * them, is `refinement-positions.ts`'s to say; whether a *slot* is walked at
 * all is `slotGate` in emit-slot.ts, which reads `carriesNestedRefinement` there.
 *
 * Each walk checks the value's shape first: a record and a map are objects, a
 * `List` and a `Tuple` arrays, a union / `Option` / `Result` value carries one
 * of its tags. A value of the wrong shape answers the position's predicates
 * `false` rather than passing untested or throwing (§1.3.3), and is reported
 * against the first predicate the position carries.
 *
 * A named type (or an applied generic) is lowered once into a module-level
 * helper and referenced from everywhere it occurs, which is what makes a
 * recursive type (`type Tree = {label: Text where nonempty, kids: List(Tree)}`)
 * a function that calls itself rather than a walk that never ends. The value
 * is finite, and a position it does not have fails the shape check instead of
 * recursing (`type Loop = {next: Loop, …}` on a value with no `next`), so the
 * check is too.
 */

/** A failure as the runtime reads it back: see `RefinementFailure` in core.ts. */
const FAIL = (r: Refinement): string =>
  `{ kind: ${JSON.stringify(r.pred)}, args: ${JSON.stringify(r.args)}, path: [] }`;

export type NestedRefinements = {
  /**
   * The module-level helper declarations the explainers handed out so far
   * refer to. The slot table names them by bare identifier (`refineFailure:
   * _rq0`), and a `const` is in its temporal dead zone for a plain reference as
   * much as for a call — so these have to precede the slot table. Each is a
   * `const` arrow, including the one a name aliasing another helper gets
   * (`(v) => _rq3(v)`, never an eager `= _rq3`, whose target may not be
   * declared yet), so they refer to one another only when they run and their
   * order among themselves does not matter.
   */
  readonly decls: string[];
  /**
   * The name of a module-level function answering the first predicate a value
   * of `t` fails, with its path, or `undefined` when `t` carries none at all.
   * Defined whenever `carriesNestedRefinement(t)` holds.
   */
  explainerOf(t: TypeExpr): string | undefined;
};

export function nestedRefinements(env: TypeEnv): NestedRefinements {
  const decls: string[] = [];
  const helpers = new Map<string, string>();
  let next = 0;

  const carries = (t: TypeExpr): boolean => scanPositions(t, env).carries;

  /**
   * One step into a position: `f` is the failure found there. The check is
   * called by name — an inline arrow would be a closure built on every call.
   */
  const at = (stepJs: string, check: string, valueJs: string): string =>
    `if ((f = ${named$(check)}(${valueJs}))) return { ...f, path: [${stepJs}, ...f.path] };`;

  /** `check` as a helper's name, declaring it first when it is an arrow. */
  const named$ = (check: string): string => (isHelper(check) ? check : hoist(check));

  /** Refuse a value of the wrong shape against the first predicate `t`'s positions carry. */
  const walk = (t: TypeExpr, shape: string, steps: string[]): string | undefined => {
    if (steps.length === 0) return undefined;
    const r = firstRefinement(t, env);
    return fnOf(r ? [`if (!(${shape})) return ${FAIL(r)};`, ...steps] : steps);
  };

  /**
   * `generics` is the program generics being expanded, outermost first. The
   * checker reports a type that nests one inside itself past the limit
   * (E0803), so reaching the limit here means that report was skipped.
   */
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
      case "TypeRefinement": {
        // Base outward (§1.3.1): whatever the inner type refuses is named
        // before the predicate written on top of it.
        const steps: string[] = [];
        const inner = explain(t.inner, generics);
        if (inner) steps.push(`if ((f = ${named$(inner)}(v))) return f;`);
        const r = t.refinement;
        const body = r ? refinementBodyJs(r) : undefined;
        if (r && body) steps.push(`if (!(${body})) return ${FAIL(r)};`);
        return fnOf(steps);
      }
      case "TypeRecord":
        return walk(
          t,
          'v !== null && typeof v === "object" && !Array.isArray(v)',
          t.fields.flatMap((field) => {
            const check = explain(field.type, generics);
            const name = JSON.stringify(field.name);
            return check ? [at(name, check, `v[${name}]`)] : [];
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
    const inner = t.kind === "TypeApp" ? [...generics, t.name] : generics;
    if (inner.filter((n) => n === t.name).length > GENERIC_SELF_NESTING_LIMIT) {
      throw new Error(
        `nested refinement lowering: "${t.name}" nests inside itself past the limit, which the checker reports as E0803 before codegen runs`,
      );
    }
    // Registered before the body is lowered, so a recursive occurrence inside
    // it becomes a call to this helper. What the body lowers to depends on the
    // key alone, so the helper is the same wherever the type occurs.
    const name = `_rq${next++}`;
    helpers.set(key, name);
    const fn = explain(body, inner);
    if (fn === undefined) {
      throw new Error(`nested refinement lowering: "${t.name}" carries a refinement with no walk`);
    }
    decls.push(`const ${name} = ${isHelper(fn) ? `(v) => ${fn}(v)` : fn};`);
    return name;
  };

  /** `js`, a key, as the key type reads it: a number when the type is one over a number. */
  const keyJs = (k: TypeExpr | undefined, js: string): string => {
    const base = k ? unaliasType(k, env) : null;
    const numeric =
      base?.kind === "TypePrim" &&
      (base.name === "Int" || base.name === "Float" || base.name === "Time");
    return numeric ? `(typeof ${js} === "number" ? ${js} : Number(${js}))` : js;
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
      return check
        ? [`if (v._tag === ${name}) { ${at(`{ variant: ${name} }`, check, "v._0")} }`]
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
      // A set's members are an object's keys at runtime (`setAdd`,
      // `setToggle`), so they are strings, read back as a number for a member
      // over one. A set literal is still an array, and a literal a member was
      // added to is that array's entries plus keys: an entry whose value is not
      // the `true` a key maps to is a member held as itself.
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

  return {
    decls,
    explainerOf: (t) => {
      const fn = explain(t, []);
      return fn === undefined || isHelper(fn) ? fn : hoist(fn);
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

const isHelper = (fn: string): boolean => /^_rq\d+$/.test(fn);

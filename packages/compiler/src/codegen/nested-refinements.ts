import { VARIANT_TAG_FIELD } from "@kumikijs/runtime/variant-tag";
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

  let indexDeclared = false;

  /**
   * A focus whose next step is not an index names nothing here, so the position
   * is checked whole, as `at` checks one no step can name. `named` says whether
   * the index `o[0].at` names this position; a Map key (`named` `null`) is named
   * by no index, so a focus that names an entry skips the key's predicates.
   */
  const atIndex = (
    stepJs: string,
    check: string,
    valueJs: string,
    named: string | null,
  ): string => {
    if (!indexDeclared) {
      indexDeclared = true;
      decls.push(
        `const _rqAt = (o) => typeof o?.[0] === "object" && o[0] !== null && "at" in o[0];`,
      );
    }
    const found = `return { ...f, path: [${stepJs}, ...f.path] };`;
    return named === null
      ? `if (!_rqAt(o) && (f = ${named$(check)}(${valueJs}))) ${found}`
      : `if ((!_rqAt(o) || ${named}) && (f = ${named$(check)}(${valueJs}, _rqAt(o) ? o.slice(1) : undefined))) ${found}`;
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
          t.variants
            .map((variant) => `v?.${VARIANT_TAG_FIELD} === ${JSON.stringify(variant.name)}`)
            .join(" || "),
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
                `if (v.${VARIANT_TAG_FIELD} === ${tag}) { ${at(step, check, `v[${JSON.stringify(`_${i}`)}]`)} }`,
              ];
            }),
          ),
        );
      default:
        assertNever(t);
        return undefined;
    }
  };

  /**
   * A named type or applied program generic reached as a position: one helper per key, shared by
   * every occurrence, that walks the links of its chain. A name a chain passed through already has
   * its link, so its helper adds none.
   */
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
    const link = links.get(key);
    const fn = link === undefined ? chainJs(body, inner, key) : checkOf(link);
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

  /** One level of a chain's checks: the type the chain ends at first, then predicates base outward. */
  const ownSteps = (outermostFirst: readonly Refinement[], end: string | undefined): string[] => {
    const steps: string[] = [];
    if (end) steps.push(`if ((f = ${named$(end)}(v, o))) return f;`);
    for (const r of [...outermostFirst].reverse()) {
      const body = refinementBodyJs(r);
      if (body) steps.push(`if (!(${body})) return ${FAIL(r)};`);
    }
    return steps;
  };

  // A link per level of a chain with checks of its own, `[own, below]`: chains that share a tail
  // share its links, and one loop walks a chain however long it is, where a call per name would be
  // a frame per name at runtime.
  type Link = { readonly name: string; readonly chained: boolean };
  const links = new Map<string, Link>();
  let walkerDeclared = false;

  const checkOf = (link: Link): string => {
    if (!link.chained) return `${link.name}[0]`;
    if (!walkerDeclared) {
      walkerDeclared = true;
      decls.push(WALK_LINKS);
    }
    return `(v, o) => _rqLinks(${link.name}, v, o)`;
  };

  type Level = { readonly key: string | null; readonly outermostFirst: Refinement[] };

  /** `t`'s chain, followed from `key` when `t` is the body of that name. */
  const chainJs = (
    t: TypeExpr,
    generics: readonly string[],
    key: string | null = null,
  ): string | undefined => {
    let level: Level = { key, outermostFirst: [] };
    const levels = [level];
    const entered = new Set<string>(key === null ? [] : [key]);
    let inner = generics;
    let below: Link | undefined;
    let endsAtName = false;
    let cur = t;
    for (;;) {
      if (cur.kind === "TypeNominal" || cur.kind === "TypeRefinement") {
        if (cur.refinement) level.outermostFirst.push(cur.refinement);
        cur = cur.inner;
        continue;
      }
      if (cur.kind !== "TypeRef" && cur.kind !== "TypeApp") break;
      const body = expandNamed(cur, env);
      if (!body) break;
      const at = typeKey(cur);
      below = links.get(at);
      endsAtName = below !== undefined || helpers.has(at) || entered.has(at);
      if (endsAtName) break;
      entered.add(at);
      inner = entering(cur, inner);
      level = { key: at, outermostFirst: [] };
      levels.push(level);
      cur = body;
    }
    const end = below === undefined ? explain(cur, inner) : undefined;
    // A single level needs no link when nothing can stack calls on it: a position's own type is
    // reached by no other chain, and a name whose chain ends at a type of its own calls no other
    // chain's check.
    if (levels.length === 1 && below === undefined && (key === null || !endsAtName)) {
      return level.outermostFirst.length === 0 ? end : fnOf(ownSteps(level.outermostFirst, end));
    }
    const owns = levels.map((l, i) =>
      ownSteps(l.outermostFirst, i === levels.length - 1 ? end : undefined),
    );
    // Emitted from the base outward, so the link below is declared before the one that names it.
    let link = below;
    for (let i = levels.length - 1; i >= 0; i -= 1) {
      const own = owns[i] ?? [];
      if (own.length > 0) {
        const name = `_rq${next++}`;
        // Falling off the end answers `undefined`, which a link says by returning nothing.
        const fn = `(v, o) => { ${localOf(own)}${own.join(" ")} }`;
        decls.push(`const ${name} = [${fn}${link ? `, ${link.name}` : ""}];`);
        link = { name, chained: link !== undefined };
      }
      const at = levels[i]?.key ?? null;
      if (at !== null && link !== undefined) links.set(at, link);
    }
    return link === undefined ? undefined : checkOf(link);
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
        ? [
            `if (v.${VARIANT_TAG_FIELD} === ${name}) { ${at(`{ variant: ${name} }`, check, "v._0", onPath)} }`,
          ]
        : [];
    };
    const object = 'v !== null && typeof v === "object"';
    switch (t.name) {
      case "List": {
        const check = sub(a0);
        return walk(
          t,
          "Array.isArray(v)",
          check
            ? [`for (const [i, e] of v.entries()) { ${atIndex("i", check, "e", "o[0].at === i")} }`]
            : [],
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
        const read = keyJs(a0, "k");
        const bind = read === "k" ? "" : `const kk = ${read}; `;
        const kk = read === "k" ? "k" : "kk";
        const key = sub(a0);
        if (key) {
          steps.push(
            `for (const k of Object.keys(v)) { ${bind}${atIndex(`{ key: ${kk} }`, key, kk, null)} }`,
          );
        }
        const val = sub(a1);
        if (val) {
          // By the stored key: an index that is a record or a tag is a fresh object, never `===` the entry's.
          const named = "_s.entryKey(o[0].at) === k";
          steps.push(
            `for (const [k, e] of Object.entries(v)) { ${bind}${atIndex(`{ entry: ${kk} }`, val, "e", named)} }`,
          );
        }
        return walk(t, `${object} && !Array.isArray(v)`, steps);
      }
      case "Option":
        return walk(
          t,
          `v?.${VARIANT_TAG_FIELD} === "Some" || v?.${VARIANT_TAG_FIELD} === "None"`,
          tagged("Some", a0),
        );
      case "Result":
        return walk(t, `v?.${VARIANT_TAG_FIELD} === "Ok" || v?.${VARIANT_TAG_FIELD} === "Err"`, [
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

/** Walks a chain's links from the base outward, each link's own checks in turn. */
const WALK_LINKS = [
  "const _rqLinks = (l, v, o) => {",
  "const own = [];",
  "for (let at = l; at !== undefined; at = at[1]) own.push(at[0]);",
  "let f;",
  "for (let i = own.length - 1; i >= 0; i -= 1) if ((f = own[i](v, o))) return f;",
  "return undefined;",
  "};",
].join(" ");

/** A statement-bodied explain function, or `undefined` when it has no steps. */
function fnOf(steps: string[]): string | undefined {
  if (steps.length === 0) return undefined;
  return `(v, o) => { ${localOf(steps)}${steps.join(" ")} return undefined; }`;
}

/** The `f` a check's steps assign a nested failure to, declared when one does. */
const localOf = (steps: readonly string[]): string =>
  steps.some((step) => step.includes("(f = ")) ? "let f; " : "";

const isHelper = (fn: string): boolean => /^_rq\d+$/.test(fn);

import {
  constructorArity,
  forwardedHead,
  isKnownTypeName,
  paramSubstitution,
  substituteType,
  typeToString,
  unaliasType,
  unknownType,
} from "../assignable.ts";
import {
  assertNever,
  type Pos,
  type Refinement,
  type SlotDef,
  type TypeDef,
  type TypeExpr,
} from "../ast.ts";
import { aliasTarget } from "../def-graph.ts";
import { GENERIC_SELF_NESTING_LIMIT, scanPositions, typeKey } from "../refinement-positions.ts";
import {
  type RefinementProblem,
  refinementBaseProblem,
  refinementProblem,
} from "../refinements.ts";
import type { KumikiError, SymbolTable } from "./context.ts";

export function resolveType(
  t: TypeExpr,
  sym: SymbolTable,
  errors: KumikiError[],
  typeParams: ReadonlySet<string> = EMPTY_SCOPE,
): void {
  switch (t.kind) {
    case "TypePrim":
      return;
    case "TypeRef": {
      if (typeParams.has(t.name)) return;
      if (!isKnownTypeName(t.name, sym)) {
        errors.push({
          code: "E0117",
          kind: "undef-type",
          message: `Reference to undefined type "${t.name}"`,
          pos: t.pos,
        });
        return;
      }
      checkTypeArity(t.name, 0, t.pos, sym, errors);
      return;
    }
    case "TypeApp": {
      if (!typeParams.has(t.name)) {
        if (!isKnownTypeName(t.name, sym)) {
          errors.push({
            code: "E0117",
            kind: "undef-type",
            message: `Reference to undefined type "${t.name}"`,
            pos: t.pos,
          });
        } else {
          checkTypeArity(t.name, t.args.length, t.pos, sym, errors);
          checkApplication(t, sym, typeParams, errors);
        }
      }
      for (const a of t.args) resolveType(a, sym, errors, typeParams);
      return;
    }
    case "TypeRecord":
      for (const f of t.fields) resolveType(f.type, sym, errors, typeParams);
      return;
    case "TypeUnion":
      for (const v of t.variants)
        for (const p of v.payloads) resolveType(p, sym, errors, typeParams);
      return;
    case "TypeNominal":
    case "TypeRefinement":
      checkRefinement(t.refinement, t.inner, sym, typeParams, errors);
      resolveType(t.inner, sym, errors, typeParams);
      return;
  }
}

export function checkNestedLowering(slot: SlotDef, sym: SymbolTable, errors: KumikiError[]): void {
  const { cut } = scanPositions(slot.type, sym);
  if (cut === undefined) return;
  errors.push({
    code: "E0803",
    kind: "unimplemented-refinement",
    message: `Refinement inside slot "${slot.name}" is not enforced by the runtime: "${cut}" applies itself to a growing argument more than ${GENERIC_SELF_NESTING_LIMIT} levels deep`,
    pos: slot.pos,
  });
}

function checkRefinement(
  r: Refinement | undefined,
  inner: TypeExpr,
  sym: SymbolTable,
  typeParams: ReadonlySet<string>,
  errors: KumikiError[],
): void {
  if (!r) return;
  const problem = refinementProblem(r) ?? baseProblem(r, inner, sym, typeParams);
  if (!problem) return;
  if (problem.kind === "unimplemented-refinement") {
    errors.push({
      code: "E0803",
      kind: "unimplemented-refinement",
      message: problem.message,
      pos: r.pos,
    });
    return;
  }
  errors.push({
    code: "E0804",
    kind: "refinement-args-invalid",
    message: problem.message,
    pos: r.pos,
  });
}

/** {@link refinementBaseProblem} for `r` over `inner`, as a checker problem. */
function baseProblem(
  r: Refinement,
  inner: TypeExpr,
  sym: SymbolTable,
  typeParams: ReadonlySet<string>,
): RefinementProblem | undefined {
  const base = judgedBase(substituteType(inner, opaqueParams(typeParams, inner.pos)), sym);
  const message = base ? refinementBaseProblem(r, base) : undefined;
  return message ? { kind: "refinement-args-invalid", message } : undefined;
}

/** Each of `params` mapped to the opaque type, so that nothing is concluded from it. */
function opaqueParams(params: Iterable<string>, pos: Pos): Map<string, TypeExpr> {
  return new Map([...params].map((p) => [p, unknownType(pos)]));
}

function judgedBase(t: TypeExpr, sym: SymbolTable): TypeExpr | undefined {
  const base = unaliasType(t, sym);
  if (base === null) return undefined;
  if (base.kind === "TypeApp" && !isKnownTypeName(base.name, sym)) return undefined;
  return base;
}

function checkApplication(
  app: TypeExpr & { kind: "TypeApp" },
  sym: SymbolTable,
  typeParams: ReadonlySet<string>,
  errors: KumikiError[],
): void {
  const def = sym.types.get(app.name);
  if (!def) return;
  const opaque = opaqueParams(typeParams, app.pos);
  const args = app.args.map((a) => substituteType(a, opaque));
  const unapplied = def.params.map(() => unknownType(app.pos));
  const run: AppliedRun = {
    shown: typeToString(app),
    sym,
    reported: new Map(),
    out: [],
  };
  appliedBaseProblems(app.name, args, unapplied, run, { entered: null, from: null, walked: null });
  for (const message of run.out) {
    errors.push({ code: "E0804", kind: "refinement-args-invalid", message, pos: app.pos });
  }
}

type AppliedRun = {
  readonly shown: string;
  readonly sym: SymbolTable;
  readonly reported: Map<Refinement, Set<string>>;
  readonly out: string[];
};

type AppliedScope = {
  readonly entered: string | null;
  readonly from: AppliedScope | null;
  walked: WalkedApplication[] | null;
};

/** Whether `name` was entered on the way to `scope`. */
function hasEntered(scope: AppliedScope, name: string): boolean {
  for (let s: AppliedScope | null = scope; s; s = s.from) if (s.entered === name) return true;
  return false;
}

type WalkedApplication = {
  readonly name: string;
  readonly args: readonly TypeExpr[];
  readonly judged: readonly TypeExpr[];
};

function sameNodes(a: readonly TypeExpr[], b: readonly TypeExpr[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function readAlike(a: readonly TypeExpr[], b: readonly TypeExpr[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || typeKey(x) !== typeKey(y)) return false;
  }
  return true;
}

/** Whether `name` has been walked from `scope` with these very argument nodes. */
function walkedFrom(
  scope: AppliedScope,
  name: string,
  args: readonly TypeExpr[],
  judged: readonly TypeExpr[],
): boolean {
  if (!scope.walked) return false;
  for (const w of scope.walked) {
    if (w.name === name && sameNodes(w.args, args) && sameNodes(w.judged, judged)) return true;
  }
  return false;
}

/** Record `message` for `r`, unless `r` has already given it. */
function reportApplied(run: AppliedRun, r: Refinement, message: string): void {
  let given = run.reported.get(r);
  if (!given) {
    given = new Set();
    run.reported.set(r, given);
  }
  if (given.has(message)) return;
  given.add(message);
  run.out.push(message);
}

// A stack rather than a recursion: a chain of generics, each applying the one below, is as long
// as the program makes it. Work is pushed in reverse so the messages come out in depth-first order.
function appliedBaseProblems(
  name: string,
  args: readonly TypeExpr[],
  judged: readonly TypeExpr[],
  run: AppliedRun,
  scope: AppliedScope,
): void {
  const todo: AppliedWork[] = [{ kind: "enter", name, args, judged, scope }];
  for (let work = todo.pop(); work !== undefined; work = todo.pop()) {
    if (work.kind === "enter") enterApplied(work, run, todo);
    else walkApplied(work.t, work.at, run, todo);
  }
}

type AppliedWork =
  | {
      readonly kind: "enter";
      readonly name: string;
      readonly args: readonly TypeExpr[];
      readonly judged: readonly TypeExpr[];
      readonly scope: AppliedScope;
    }
  | { readonly kind: "walk"; readonly t: TypeExpr; readonly at: AppliedBody };

type AppliedBody = {
  readonly applied: ReadonlyMap<string, TypeExpr>;
  readonly before: ReadonlyMap<string, TypeExpr>;
  readonly inside: AppliedScope;
};

function enterApplied(
  work: AppliedWork & { kind: "enter" },
  run: AppliedRun,
  todo: AppliedWork[],
): void {
  const { name, scope } = work;
  const { sym } = run;
  const def = sym.types.get(name);
  if (!def || hasEntered(scope, name) || def.params.length !== work.args.length) return;
  const args = work.args.map((a) => forwardedHead(a, sym));
  const judged = work.judged.map((a) => forwardedHead(a, sym));
  // Arguments that read as the judged ones make every was/now pair below one type read twice,
  // which can never report, so the walk is not taken.
  if (readAlike(args, judged)) return;
  if (walkedFrom(scope, name, args, judged)) return;
  scope.walked ??= [];
  scope.walked.push({ name, args, judged });
  const at: AppliedBody = {
    applied: paramSubstitution(def.params, args),
    before: paramSubstitution(def.params, judged),
    inside: { entered: name, from: scope, walked: null },
  };
  todo.push({ kind: "walk", t: def.body, at });
}

function walkApplied(t: TypeExpr, at: AppliedBody, run: AppliedRun, todo: AppliedWork[]): void {
  const parts = (xs: readonly TypeExpr[]): void => {
    for (let i = xs.length - 1; i >= 0; i -= 1) {
      const x = xs[i];
      if (x) todo.push({ kind: "walk", t: x, at });
    }
  };
  switch (t.kind) {
    case "TypePrim":
    case "TypeRef":
      return;
    case "TypeApp":
      parts(t.args);
      todo.push({
        kind: "enter",
        name: t.name,
        args: t.args.map((a) => substituteType(a, at.applied)),
        judged: t.args.map((a) => substituteType(a, at.before)),
        scope: at.inside,
      });
      return;
    case "TypeRecord":
      parts(t.fields.map((f) => f.type));
      return;
    case "TypeUnion":
      parts(t.variants.flatMap((v) => v.payloads));
      return;
    case "TypeNominal":
    case "TypeRefinement": {
      const r = t.refinement;
      // A problem with the arguments is the definition's, reported there.
      if (r && !refinementProblem(r)) {
        const was = judgedBase(substituteType(t.inner, at.before), run.sym);
        const now = judgedBase(substituteType(t.inner, at.applied), run.sym);
        if (now && !(was && refinementBaseProblem(r, was))) {
          const over = `${run.shown} applies it over ${typeToString(now)}`;
          const message = refinementBaseProblem(r, now, over);
          if (message) reportApplied(run, r, message);
        }
      }
      todo.push({ kind: "walk", t: t.inner, at });
      return;
    }
    default:
      assertNever(t);
  }
}

function checkTypeArity(
  name: string,
  given: number,
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const arity = constructorArity(name, sym);
  // `Tuple` takes any number of arguments, and none is still not a type.
  if (arity === null ? given > 0 : arity === given) return;
  errors.push({
    code: "E0210",
    kind: "type-arity-mismatch",
    message:
      arity === null
        ? `Type "${name}" expects type arguments but got none`
        : `Type "${name}" expects ${arity} type argument(s) but got ${given}`,
    pos,
  });
}

const EMPTY_SCOPE: ReadonlySet<string> = new Set();

export function checkTypeDef(def: TypeDef, sym: SymbolTable, errors: KumikiError[]): void {
  resolveType(def.body, sym, errors, new Set(def.params));
}

/**
 * Whether a definition `t` names, directly or through the ones it names, has an error of its own:
 * one {@link checkTypeDef} reports, or an alias that resolves to itself (E0009).
 */
export function reachesBrokenDefinition(t: TypeExpr, sym: SymbolTable): boolean {
  const reached = new Map<string, TypeDef>();
  const todo: { t: TypeExpr; params: ReadonlySet<string> }[] = [{ t, params: EMPTY_SCOPE }];
  for (let at = todo.pop(); at !== undefined; at = todo.pop()) {
    const { t: cur, params } = at;
    const inside = (parts: readonly TypeExpr[]) => {
      for (const p of parts) todo.push({ t: p, params });
    };
    switch (cur.kind) {
      case "TypePrim":
        break;
      case "TypeRef":
      case "TypeApp": {
        if (cur.kind === "TypeApp") inside(cur.args);
        const def = params.has(cur.name) ? undefined : sym.types.get(cur.name);
        if (!def || reached.has(def.name)) break;
        reached.set(def.name, def);
        todo.push({ t: def.body, params: new Set(def.params) });
        break;
      }
      case "TypeRecord":
        inside(cur.fields.map((f) => f.type));
        break;
      case "TypeUnion":
        inside(cur.variants.flatMap((v) => v.payloads));
        break;
      case "TypeNominal":
      case "TypeRefinement":
        inside([cur.inner]);
        break;
      default:
        assertNever(cur);
    }
  }
  const scratch: KumikiError[] = [];
  for (const def of reached.values()) checkTypeDef(def, sym, scratch);
  return scratch.length > 0 || [...reached.values()].some(aliasCycleFinder(sym));
}

/** Whether following alias targets from a definition comes back round, each one walked once. */
function aliasCycleFinder(sym: SymbolTable): (def: TypeDef) => boolean {
  const typeOf = (name: string): TypeDef | undefined => sym.types.get(name);
  const settled = new Set<string>();
  return (start) => {
    const path = new Set<string>();
    for (let d = typeOf(start.name); d !== undefined && !settled.has(d.name); ) {
      if (path.has(d.name)) return true;
      path.add(d.name);
      const edge = aliasTarget(d, typeOf);
      d = edge ? typeOf(edge.to) : undefined;
    }
    for (const name of path) settled.add(name);
    return false;
  };
}

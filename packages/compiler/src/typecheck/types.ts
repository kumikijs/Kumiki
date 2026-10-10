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
import { GENERIC_SELF_NESTING_LIMIT, scanPositions } from "../refinement-positions.ts";
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
  scope: TypeScope = EMPTY_SCOPE,
): void {
  const typeParams = scope.params;
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
      if (typeParams.has(t.name)) {
        // Substitution leaves such an application opaque, so this is its one report.
        errors.push({
          code: "E0210",
          kind: "type-arity-mismatch",
          message: `Type parameter "${t.name}" of "${scope.owner}" takes no type arguments, but is written "${t.name}(${t.args.map(typeToString).join(", ")})"`,
          pos: t.pos,
        });
      } else if (!isKnownTypeName(t.name, sym)) {
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
      for (const a of t.args) resolveType(a, sym, errors, scope);
      return;
    }
    case "TypeRecord":
      for (const f of t.fields) resolveType(f.type, sym, errors, scope);
      return;
    case "TypeUnion":
      for (const v of t.variants) for (const p of v.payloads) resolveType(p, sym, errors, scope);
      return;
    case "TypeNominal":
    case "TypeRefinement":
      checkRefinement(t.refinement, t.inner, sym, typeParams, errors);
      resolveType(t.inner, sym, errors, scope);
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
  const base = unaliasType(substituteType(inner, opaqueParams(typeParams, inner.pos)), sym);
  const message = base ? refinementBaseProblem(r, base) : undefined;
  return message ? { kind: "refinement-args-invalid", message } : undefined;
}

/** Each of `params` mapped to the opaque type, so that nothing is concluded from it. */
function opaqueParams(params: Iterable<string>, pos: Pos): Map<string, TypeExpr> {
  return new Map([...params].map((p) => [p, unknownType(pos)]));
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

function appliedBaseProblems(
  name: string,
  writtenArgs: readonly TypeExpr[],
  writtenJudged: readonly TypeExpr[],
  run: AppliedRun,
  scope: AppliedScope,
): void {
  const { sym } = run;
  const def = sym.types.get(name);
  if (!def || hasEntered(scope, name) || def.params.length !== writtenArgs.length) return;
  const args = writtenArgs.map((a) => forwardedHead(a, sym));
  const judged = writtenJudged.map((a) => forwardedHead(a, sym));
  if (walkedFrom(scope, name, args, judged)) return;
  scope.walked ??= [];
  scope.walked.push({ name, args, judged });
  const applied = paramSubstitution(def.params, args);
  const before = paramSubstitution(def.params, judged);
  const inside: AppliedScope = { entered: name, from: scope, walked: null };
  const walk = (t: TypeExpr): void => {
    switch (t.kind) {
      case "TypePrim":
      case "TypeRef":
        return;
      case "TypeApp": {
        // Substituted whole, so that a parameter at the head leaves no application to
        // enter rather than naming a top-level generic.
        const nested = substituteType(t, applied);
        if (nested.kind === "TypeApp") {
          const nestedBefore = t.args.map((a) => substituteType(a, before));
          appliedBaseProblems(t.name, nested.args, nestedBefore, run, inside);
        }
        for (const a of t.args) walk(a);
        return;
      }
      case "TypeRecord":
        for (const f of t.fields) walk(f.type);
        return;
      case "TypeUnion":
        for (const v of t.variants) for (const p of v.payloads) walk(p);
        return;
      case "TypeNominal":
      case "TypeRefinement": {
        const r = t.refinement;
        // A problem with the arguments is the definition's, reported there.
        if (r && !refinementProblem(r)) {
          const was = unaliasType(substituteType(t.inner, before), sym);
          const now = unaliasType(substituteType(t.inner, applied), sym);
          if (now && !(was && refinementBaseProblem(r, was))) {
            const over = `${run.shown} applies it over ${typeToString(now)}`;
            const message = refinementBaseProblem(r, now, over);
            if (message) reportApplied(run, r, message);
          }
        }
        walk(t.inner);
        return;
      }
      default:
        assertNever(t);
    }
  };
  walk(def.body);
}

function checkTypeArity(
  name: string,
  given: number,
  pos: Pos,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const arity = constructorArity(name, sym);
  if (arity === null || arity === given) return;
  errors.push({
    code: "E0210",
    kind: "type-arity-mismatch",
    message: `Type "${name}" expects ${arity} type argument(s) but got ${given}`,
    pos,
  });
}

type TypeScope = { readonly owner: string; readonly params: ReadonlySet<string> };

const EMPTY_SCOPE: TypeScope = { owner: "", params: new Set() };

export function checkTypeDef(def: TypeDef, sym: SymbolTable, errors: KumikiError[]): void {
  resolveType(def.body, sym, errors, { owner: def.name, params: new Set(def.params) });
}

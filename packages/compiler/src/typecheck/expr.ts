import { elementType, nominallyComparable, typeToString, unaliasType } from "../assignable.ts";
import type { Expr, FragmentShape, Pos, TypeExpr } from "../ast.ts";
import { FRAGMENT_ARGUMENTS, KNOWN_METHODS, METHOD_MIN_ARGS } from "../codegen.ts";
import {
  checkAgainst,
  checkEmitTarget,
  checkGetArity,
  checkGetOrArity,
  checkRecordUpdate,
  getOrResultType,
} from "./against.ts";
import { arithmeticHint, checkCallee, reportRunReducerPosition } from "./callee.ts";
import {
  bindLocal,
  type Ctx,
  innerScope,
  type KumikiError,
  type SymbolTable,
  wildcardText,
} from "./context.ts";
import { currentFnName } from "./fn.ts";
import {
  arithmeticResult,
  inferType,
  isKnown,
  isNumeric,
  isPrimNamed,
  KNOWN_TOKEN_GROUPS,
  prim,
} from "./infer.ts";
import {
  classifyFieldAccess,
  classifyMember,
  fragmentBindings,
  fragmentShape,
  KEY_READER_NAMES,
  keyKindOfReader,
  undefMemberError,
} from "./members.ts";
import { checkPatternAgainstType, checkPatternBindsAreDistinct } from "./patterns.ts";
import { checkListIndex } from "./reducer.ts";
import { routeInAppInitMessage } from "./route-chain.ts";

/** The type one iteration of `for x in iter` binds, given the iterated expression. */
export function elementTypeOf(iter: Expr, sym: SymbolTable, ctx: Ctx): TypeExpr | null {
  return elementType(inferType(iter, sym, ctx), sym);
}

export function checkIterationTarget(
  iter: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const t = unaliasType(inferType(iter, sym, ctx), sym);
  if (t?.kind !== "TypeApp") return;
  const remedy = t.name === "Map" ? "keys" : t.name === "Set" ? "to-list" : null;
  if (!remedy) return;
  const alternative = t.name === "Map" ? " (or .values, which binds the value)" : "";
  errors.push({
    code: "E0218",
    kind: "for-over-non-list",
    message: `"for" iterates a List, but this is a ${t.name} — iterate its .${remedy}${alternative}`,
    pos: iter.pos,
  });
}

export function checkExpr(e: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
    case "Unit":
      return;
    case "Ref": {
      if (
        (e.name === "route" || e.name === "$route") &&
        ctx.kind === "app-init" &&
        !ctx.localBinds.has(e.name)
      ) {
        ctx.routeReadsSeen?.push({ name: e.name, pos: e.pos });
        errors.push({
          code: "E0120",
          kind: "route-in-app-init",
          message: routeInAppInitMessage(e.name),
          pos: e.pos,
        });
        return;
      }
      if (e.name === "$route" && ctx.routeBind !== "no-payload" && !ctx.localBinds.has(e.name)) {
        if (ctx.routeBind === "unbound") {
          errors.push({
            code: "E0119",
            kind: "route-bind-out-of-scope",
            message:
              `"$route" is only bound in a route.enter / route.leave / route.error reducer ` +
              `and in a link's prefetch target; nothing binds one here, so every field off ` +
              `it reads undefined. Read the "route" slot instead — ` +
              `it holds the current route and is in scope everywhere`,
            pos: e.pos,
          });
        }
        return;
      }
      if (ctx.localBinds.has(e.name)) return;
      if (sym.slots.has(e.name)) {
        if (ctx.kind === "fn") {
          errors.push({
            code: "E0305",
            kind: "fn-impurity",
            message: `fn "${currentFnName(ctx)}" must not read slot "${e.name}"`,
            pos: e.pos,
          });
        }
        return;
      }
      const fn = sym.fns.get(e.name);
      if (fn) {
        errors.push({
          code: "E0127",
          kind: "fn-as-value",
          message: `"${e.name}" is a fn, and a fn is not a value — write the call: ${e.name}(${fn.params.map((p) => p.name).join(", ")})`,
          pos: e.pos,
        });
        return;
      }
      if (e.name === "route" || e.name === "now" || e.name === "self") return;
      if (e.name === "$1" && ctx.kind === "tile") {
        ctx.undeclaredInputReads?.push(e.pos);
        errors.push({
          code: "E0103",
          kind: "undef-ref",
          message: `"$1" is undefined here — a tile can only use "$1" if it declares an "in=" argument (e.g. \`tile X in=SomeType = …\`)`,
          pos: e.pos,
        });
        return;
      }
      if (e.name === "$2" && ctx.oneValueFragment !== undefined) {
        const { method, hides } = ctx.oneValueFragment;
        errors.push({
          code: "E0103",
          kind: "undef-ref",
          message: hides
            ? `"$2" is not bound here — the .${method} fragment is handed one value, "$1", and its positionals hide the enclosing "$2": refer to that value by its name`
            : `"$2" is not bound here — the .${method} fragment is handed one value, "$1"; "$2" is bound only over a Map's filter or map, or a pair (Tuple(A, B), e.g. from .entries)`,
          pos: e.pos,
        });
        return;
      }
      errors.push({
        code: "E0103",
        kind: "undef-ref",
        message: `Reference to undefined name "${e.name}"${arithmeticHint(e.name, sym, ctx)}`,
        pos: e.pos,
      });
      return;
    }
    case "Variant":
      for (const p of e.payload) checkExpr(p, sym, errors, ctx);
      return;
    case "BinOp": {
      const isEffectId = (t: TypeExpr | null): boolean =>
        !!t && t.kind === "TypePrim" && t.name === "EffectId";
      let effectIdMisuse = false;
      if (e.op !== "==" && e.op !== "!=") {
        const lt = inferType(e.lhs, sym, ctx);
        const rt = inferType(e.rhs, sym, ctx);
        if (isEffectId(lt) || isEffectId(rt)) {
          effectIdMisuse = true;
          errors.push({
            code: "E0204",
            kind: "effect-id-misuse",
            message: `Operator "${e.op}" cannot be applied to EffectId — only "==" / "!=" are defined`,
            pos: e.pos,
          });
        }
      }
      checkExpr(e.lhs, sym, errors, ctx);
      checkExpr(e.rhs, sym, errors, ctx);
      if (!effectIdMisuse) checkBinOpOperands(e, sym, errors, ctx);
      return;
    }
    case "UnaryOp": {
      checkExpr(e.rhs, sym, errors, ctx);
      const rt = inferType(e.rhs, sym, ctx);
      if (e.op === "!") checkCondition(e.rhs, rt, sym, errors, '"!"');
      else if (isKnown(rt, sym) && !isNumeric(rt, sym)) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Operator "-" expects a number but got ${typeToString(rt as TypeExpr)}`,
          pos: e.rhs.pos,
        });
      }
      return;
    }
    case "FieldAccess":
      checkExpr(e.base, sym, errors, ctx);
      classifyFieldAccess(e, sym, errors, ctx);
      return;
    case "Index":
      checkExpr(e.base, sym, errors, ctx);
      checkExpr(e.index, sym, errors, ctx);
      checkListIndex(unaliasType(inferType(e.base, sym, ctx), sym), e.index, sym, errors, ctx);
      return;
    case "Call":
      if (ctx.kind === "test" && e.callee === "run-reducer") {
        reportRunReducerPosition(ctx, e.pos, errors);
        return;
      }
      for (const a of e.args) checkExpr(a, sym, errors, ctx);
      checkCallee(e.callee, e.args, e.pos, sym, errors, ctx);
      return;
    case "MethodCall": {
      // The chained spelling of the same thing: `run-reducer(inc).run-reducer(dec)`.
      if (ctx.kind === "test" && e.method === "run-reducer") {
        checkExpr(e.receiver, sym, errors, ctx);
        reportRunReducerPosition(ctx, e.pos, errors);
        return;
      }
      let lacksMember = false;
      if (!KNOWN_METHODS.has(e.method)) {
        errors.push({
          code: "E0801",
          kind: "unimplemented-method",
          message: `Method ".${e.method}" is not implemented by the runtime`,
          pos: e.pos,
        });
      } else {
        const raw = inferType(e.receiver, sym, ctx);
        const rt = unaliasType(raw, sym);
        const recordUpdate = e.method === "copy" && rt?.kind === "TypeRecord";
        if (rt && !recordUpdate && classifyMember(raw, e.method, sym) === "unknown") {
          errors.push(undefMemberError(raw, rt, e.method, e.pos, sym));
          lacksMember = true;
        }
      }
      if (!lacksMember) {
        const min = METHOD_MIN_ARGS.get(e.method);
        if (e.method === "get") {
          checkGetArity(e, sym, errors, ctx);
        } else if (min !== undefined && e.args.length < min) {
          errors.push({
            code: "E0213",
            kind: "call-arity-mismatch",
            message: `Method ".${e.method}" expects ${min} argument(s) but got ${e.args.length}`,
            pos: e.pos,
          });
        } else if (e.method === "get-or") {
          checkGetOrArity(e, sym, errors, ctx);
        }
      }
      checkExpr(e.receiver, sym, errors, ctx);
      if (e.method === "copy") checkRecordUpdate(e, sym, errors, ctx);
      {
        const recvType =
          e.args.length > 0 || KEY_READER_NAMES.has(e.method)
            ? inferType(e.receiver, sym, ctx)
            : null;
        const kind = keyKindOfReader(recvType, e.method, sym);
        if (kind) e.keyKind = kind;
        const fragment = FRAGMENT_ARGUMENTS.get(e.method);
        const shape =
          fragment?.second === "pair-value" ? fragmentShape(recvType, e.method, sym) : undefined;
        if (shape !== undefined) e.fragmentShape = shape ?? "undecided";
        for (const [i, a] of e.args.entries()) {
          if (fragment?.index !== i) {
            checkExpr(a, sym, errors, ctx);
            const declared = memberArgType(recvType, e.method, i, sym);
            if (declared !== null) checkAgainst(a, declared, sym, errors, ctx);
            // Any other count is checkGetArity's E0213, with no argument read as the index.
            if (e.method === "get" && e.args.length === 1) {
              checkListIndex(unaliasType(recvType, sym), a, sym, errors, ctx);
            }
            continue;
          }
          if (isFragmentFnName(a, sym, ctx)) {
            ctx.fragmentFnCallsSeen?.push({ name: a.name, pos: a.pos });
            if (lacksMember) continue;
            const fits = checkFragmentFnArity(a, e.method, fragment, recvType, shape, sym, errors);
            if (fits && e.method === "sort-by" && i === 0) {
              checkSortKey(sym.fns.get(a.name)?.ret ?? null, a.pos, recvType, sym, errors);
            }
            continue;
          }
          const [p1, p2] = fragmentBindings(recvType, e.method, i, sym);
          const inner = innerScope(ctx);
          bindLocal(inner, "$1", p1);
          if (shape === "value") {
            inner.localBinds.delete("$2");
            inner.localTypes.delete("$2");
            inner.oneValueFragment = { method: e.method, hides: ctx.localBinds.has("$2") };
          } else if (fragment.binds === 2) {
            bindLocal(inner, "$2", p2);
          }
          checkExpr(a, sym, errors, inner);
          if (e.method === "sort-by" && i === 0) {
            checkSortKey(inferType(a, sym, inner), a.pos, recvType, sym, errors);
          }
          const declared = memberArgType(recvType, e.method, i, sym);
          if (declared !== null) checkAgainst(a, declared, sym, errors, inner);
        }
      }
      if (e.method === "get-or") {
        const want = getOrResultType(
          unaliasType(inferType(e.receiver, sym, ctx), sym),
          e.args.length,
        );
        const fallback = e.args.at(-1);
        if (want !== null && fallback !== undefined) checkAgainst(fallback, want, sym, errors, ctx);
      }
      return;
    }
    case "Wildcard":
      if (ctx.wildcardsReportedElsewhere) return;
      errors.push({
        code: "E0109",
        kind: "test-wildcard-misuse",
        message: `Test wildcard "${wildcardText(e)}" is only valid inside a reducer-test \`expect\``,
        pos: e.pos,
      });
      return;
    case "RecordLit":
      for (const f of e.fields) checkExpr(f.value, sym, errors, ctx);
      return;
    case "ListLit":
    case "TupleLit":
      for (const it of e.items) checkExpr(it, sym, errors, ctx);
      return;
    case "MapLit":
      for (const ent of e.entries) {
        checkExpr(ent.key, sym, errors, ctx);
        checkExpr(ent.value, sym, errors, ctx);
      }
      return;
    case "MatchExpr": {
      checkExpr(e.scrutinee, sym, errors, ctx);
      const scrutType = inferType(e.scrutinee, sym, ctx);
      for (const arm of e.arms) {
        const inner = innerScope(ctx);
        checkPatternBindsAreDistinct(arm.pattern, errors);
        checkPatternAgainstType(arm.pattern, scrutType, sym, errors, inner);
        checkExpr(arm.body, sym, errors, inner);
      }
      return;
    }
    case "IfExpr":
      checkExpr(e.cond, sym, errors, ctx);
      checkCondition(e.cond, inferType(e.cond, sym, ctx), sym, errors, '"if"');
      checkExpr(e.consequent, sym, errors, ctx);
      checkExpr(e.alternate, sym, errors, ctx);
      return;
    case "LetIn": {
      checkExpr(e.value, sym, errors, ctx);
      checkExpr(e.body, sym, errors, letInScope(e, sym, ctx));
      return;
    }
    case "TokenRef":
      if (!KNOWN_TOKEN_GROUPS.has(e.group)) {
        errors.push({
          code: "E0110",
          kind: "unknown-token-group",
          message: `Unknown theme token group "@${e.group}" (allowed: ${[...KNOWN_TOKEN_GROUPS].join(", ")})`,
          pos: e.pos,
        });
      }
      return;
    case "EmitExpr":
      if (ctx.kind !== "reducer") {
        errors.push({
          code: "E0305",
          kind: "fn-impurity",
          message: `emit "${e.effect}" used as an expression is only allowed inside a reducer body`,
          pos: e.pos,
        });
        return;
      }
      checkEmitTarget(e.effect, e.args, sym, errors, ctx, e.pos);
      for (const a of e.args) checkExpr(a, sym, errors, ctx);
      return;
  }
}

function isFragmentFnName(a: Expr, sym: SymbolTable, ctx: Ctx): a is Expr & { kind: "Ref" } {
  return (
    a.kind === "Ref" && !ctx.localBinds.has(a.name) && !sym.slots.has(a.name) && sym.fns.has(a.name)
  );
}

function checkFragmentFnArity(
  a: Expr & { kind: "Ref" },
  method: string,
  fragment: { binds: 1 | 2; second?: "element" | "pair-value" },
  receiver: TypeExpr | null,
  shape: FragmentShape | null | undefined,
  sym: SymbolTable,
  errors: KumikiError[],
): boolean {
  const n = sym.fns.get(a.name)?.params.length ?? 0;
  const report = (why: string): false => {
    errors.push({
      code: "E0213",
      kind: "call-arity-mismatch",
      message: `Function "${a.name}" expects ${n} argument(s) but ${why}`,
      pos: a.pos,
    });
    return false;
  };
  if (fragment.second === "element") {
    return n === 2 || report(`.${method} supplies exactly 2 — the accumulator and the element`);
  }
  if (n === 0) return report(`.${method} needs at least 1`);
  if (n > fragment.binds) return report(`.${method} supplies at most ${fragment.binds}`);
  if (n === 2 && (shape === "value" || shape === null)) {
    const on = receiver ? ` on "${typeToString(receiver)}"` : "";
    return report(
      `.${method}${on} supplies 1 — a second positional is bound only over a Map's filter or map, or a pair (Tuple(A, B), e.g. from .entries)`,
    );
  }
  return true;
}

const COMPARISON_OPS: ReadonlySet<string> = new Set(["<", ">", "<=", ">="]);

const BOOLEAN_OPS: ReadonlySet<string> = new Set(["&", "|"]);

const EQUALITY_OPS: ReadonlySet<string> = new Set(["==", "!="]);

function orderingFamily(t: TypeExpr | null, sym: SymbolTable): string | null {
  if (isNumeric(t, sym)) return "number";
  if (isPrimNamed(t, sym, "Text")) return "text";
  if (isPrimNamed(t, sym, "Time")) return "time";
  return null;
}

function checkSortKey(
  t: TypeExpr | null,
  pos: Pos,
  recv: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  const r = unaliasType(recv, sym);
  if (r?.kind !== "TypeApp" || r.name !== "List") return;
  if (!isKnown(t, sym) || orderingFamily(t, sym) !== null) return;
  errors.push({
    code: "E0201",
    kind: "type-mismatch",
    message: `".sort-by" orders by its key as "<" does, which needs a number, Text or Time, but the key is ${typeToString(t as TypeExpr)}`,
    pos,
  });
}

export function binOpResult(
  e: Expr & { kind: "BinOp" },
  sym: SymbolTable,
  ctx: Ctx,
): TypeExpr | null {
  if (COMPARISON_OPS.has(e.op) || BOOLEAN_OPS.has(e.op) || EQUALITY_OPS.has(e.op))
    return prim("Bool", e.pos);
  const lt = inferType(e.lhs, sym, ctx);
  const rt = inferType(e.rhs, sym, ctx);
  if (e.op === "+") {
    if (isPrimNamed(lt, sym, "Text") || isPrimNamed(rt, sym, "Text")) return prim("Text", e.pos);
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return null;
  }
  return arithmeticResult(e.op, lt, rt, sym, e.pos);
}

function checkBinOpOperands(
  e: Expr & { kind: "BinOp" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const lt = inferType(e.lhs, sym, ctx);
  const rt = inferType(e.rhs, sym, ctx);
  const sides = [
    [lt, e.lhs],
    [rt, e.rhs],
  ] as const;

  const requireNumeric = (): void => {
    for (const [t, side] of sides) {
      if (isKnown(t, sym) && !isNumeric(t, sym)) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Operator "${e.op}" expects a number but got ${typeToString(t as TypeExpr)}`,
          pos: side.pos,
        });
      }
    }
  };

  if (e.op === "+") {
    if (isPrimNamed(lt, sym, "Text") || isPrimNamed(rt, sym, "Text")) return;
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return;
    requireNumeric();
    return;
  }
  if (e.op === "-" || e.op === "*" || e.op === "/" || e.op === "%") {
    requireNumeric();
    return;
  }
  if (BOOLEAN_OPS.has(e.op)) {
    for (const [t, side] of sides) {
      if (isKnown(t, sym) && !isPrimNamed(t, sym, "Bool")) {
        errors.push({
          code: "E0201",
          kind: "type-mismatch",
          message: `Operator "${e.op}" expects Bool but got ${typeToString(t as TypeExpr)}`,
          pos: side.pos,
        });
      }
    }
    return;
  }
  const incomparable = (): void => {
    errors.push({
      code: "E0201",
      kind: "type-mismatch",
      message: `Operator "${e.op}" cannot compare ${typeToString(lt as TypeExpr)} with ${typeToString(rt as TypeExpr)}`,
      pos: e.pos,
    });
  };

  if (COMPARISON_OPS.has(e.op)) {
    if (!isKnown(lt, sym) || !isKnown(rt, sym)) return;
    const lf = orderingFamily(lt, sym);
    if (lf !== null && lf === orderingFamily(rt, sym) && nominallyComparable(lt, rt, sym)) return;
    incomparable();
    return;
  }
  if (EQUALITY_OPS.has(e.op)) {
    if (!nominallyComparable(lt, rt, sym)) incomparable();
  }
}

/** A condition — `if`, `when`, `!` — must be a `Bool` when its type is known. */
export function checkCondition(
  e: Expr,
  t: TypeExpr | null,
  sym: SymbolTable,
  errors: KumikiError[],
  site: string,
): void {
  if (!isKnown(t, sym) || isPrimNamed(t, sym, "Bool")) return;
  errors.push({
    code: "E0201",
    kind: "type-mismatch",
    message: `Condition of ${site} must be Bool but got ${typeToString(t as TypeExpr)}`,
    pos: e.pos,
  });
}

const MISMATCH_KIND = {
  E0201: "type-mismatch",
  E0202: "emit-arg-type-mismatch",
} as const;

export type MismatchCode = keyof typeof MISMATCH_KIND;

export function pushMismatch(
  errors: KumikiError[],
  code: MismatchCode,
  message: string,
  pos: Pos,
): void {
  errors.push({ code, kind: MISMATCH_KIND[code], message, pos });
}

/** The scope a `let … in` body is read in: the enclosing one, with the name bound. */
export function letInScope(e: Expr & { kind: "LetIn" }, sym: SymbolTable, ctx: Ctx): Ctx {
  const inner: Ctx = {
    ...ctx,
    localBinds: new Set(ctx.localBinds),
    localTypes: new Map(ctx.localTypes),
  };
  bindLocal(inner, e.name, inferType(e.value, sym, ctx));
  return inner;
}

function memberArgType(
  recv: TypeExpr | null,
  member: string,
  index: number,
  sym: SymbolTable,
): TypeExpr | null {
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp") return null;
  const [a, b] = t.args;
  switch (t.name) {
    case "List":
      return index === 0 && LIST_ELEMENT_ARGS.has(member) ? (a ?? null) : null;
    case "Map":
      return index === 1 && MAP_VALUE_ARGS.has(member) ? (b ?? null) : null;
    case "Set":
      return index === 0 && SET_OPERANDS.has(member) ? recv : null;
    default:
      return null;
  }
}

const LIST_ELEMENT_ARGS: ReadonlySet<string> = new Set(["contains", "push", "prepend"]);

const MAP_VALUE_ARGS: ReadonlySet<string> = new Set(["insert", "update"]);

const SET_OPERANDS: ReadonlySet<string> = new Set(["union", "intersect", "diff"]);

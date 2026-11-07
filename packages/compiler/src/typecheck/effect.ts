import { nearestName } from "@kumikijs/runtime/text-distance";
import { typeToString, unaliasType } from "../assignable.ts";
import type { EffectDef, Expr, Pos, TypeExpr } from "../ast.ts";
import {
  BUILTIN_EFFECTS,
  declaresNoInput,
  failsWithText,
  requestFields,
  requestFieldType,
} from "../capabilities.ts";
import { type UnkeyedPart, unkeyedPart } from "../unkeyed-part.ts";
import { checkAgainst } from "./against.ts";
import { type Ctx, type KumikiError, pureScope, type SymbolTable } from "./context.ts";
import { checkExpr, letInScope } from "./expr.ts";
import { inferType } from "./infer.ts";
import { armScope, matchedType } from "./patterns.ts";
import { resolveType } from "./types.ts";

export function effectPayloadType(
  effect: string,
  outcome: "ok" | "err",
  sym: SymbolTable,
): TypeExpr | null {
  const eff = sym.effects.get(effect);
  const out = eff?.outType;
  if (!eff || !out) return null;
  const u = unaliasType(out, sym);
  const result = u?.kind === "TypeApp" && u.name === "Result" ? u : null;
  if (outcome === "err") {
    if (result?.args.length !== 2 || !failsWithText(eff.cap)) return null;
    return { kind: "TypePrim", name: "Text", pos: eff.pos };
  }
  if (result) return result.args.length === 2 ? (result.args[0] ?? null) : null;
  return out;
}

export function effectOutcomeType(
  effect: string,
  outcome: "ok" | "err",
  sym: SymbolTable,
): TypeExpr | null {
  if (outcome === "ok") return effectPayloadType(effect, "ok", sym);
  const out = unaliasType(sym.effects.get(effect)?.outType ?? null, sym);
  return out?.kind === "TypeApp" && out.name === "Result" && out.args.length === 2
    ? (out.args[1] ?? null)
    : null;
}

export function checkEffect(eff: EffectDef, sym: SymbolTable, errors: KumikiError[]): void {
  // The runtime registers each standard effect at mount, over whatever codegen wrote under its
  // name, so a declaration under one never runs.
  if (BUILTIN_EFFECTS.has(eff.name)) {
    errors.push({
      code: "E0234",
      kind: "reserved-effect-name",
      message: `Effect "${eff.name}" collides with the built-in effect ${eff.name}; emits of it never run this effect`,
      pos: eff.pos,
    });
  }
  resolveType(eff.inType, sym, errors);
  resolveType(eff.outType, sym, errors);
  if (eff.cap === "http.cancel") {
    const inOk = eff.inType.kind === "TypePrim" && eff.inType.name === "EffectId";
    const outOk = eff.outType.kind === "TypePrim" && eff.outType.name === "Unit";
    if (!inOk || !outOk) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel must declare in=EffectId out=Unit`,
        pos: eff.pos,
      });
    }
    if (eff.policy) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel cannot declare a policy`,
        pos: eff.pos,
      });
    }
    if (eff.retry) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel cannot declare retry`,
        pos: eff.pos,
      });
    }
    if (eff.mapRequest) {
      errors.push({
        code: "E0303",
        kind: "invalid-cancel-target",
        message: `effect "${eff.name}" with cap=http.cancel cannot declare map-request`,
        pos: eff.pos,
      });
    }
  }
  checkTextFailure(eff, sym, errors);
  if (eff.mapRequest) {
    const scope = effectScope(eff, sym);
    checkExpr(eff.mapRequest, sym, errors, scope);
    const fields = requestFields(eff.cap);
    if (fields) checkRequestFields(eff.mapRequest, { cap: eff.cap, fields, sym, errors }, scope);
  }
  // The key runs at dispatch time, so a name unchecked here fails on the first
  // dispatch rather than at check time.
  if (eff.policy?.kind === "PolLatestKey") {
    const scope = effectScope(eff, sym);
    checkExpr(eff.policy.key, sym, errors, scope);
    checkPolicyKeyType(eff.policy.key, sym, scope, errors);
  }
}

/** Why a key that is `part`, or holds it, is not keyed by its value. */
function unkeyedReason({ part, whole }: UnkeyedPart): string {
  const subject = `${whole ? "it is" : "it holds"} a ${part}`;
  switch (part) {
    case "Float":
      return whole
        ? `${subject}, and NaN is one key though NaN == NaN is false`
        : `${subject}, and inside it NaN, Infinity and -Infinity are one key`;
    case "File":
      return `${subject}, and two Files with the same name, size and type are one key, while == holds only of a File and itself`;
    case "Set":
      return `${subject}, whose == depends on how it was built`;
  }
}

// The dispatcher aborts an in-flight request when another starts under the same key, so a key
// that is one key for two values `==` calls different aborts a request it has no reason to.
function checkPolicyKeyType(key: Expr, sym: SymbolTable, scope: Ctx, errors: KumikiError[]): void {
  const type = inferType(key, sym, scope);
  const unkeyed = unkeyedPart(type, sym);
  if (!type || !unkeyed) return;
  errors.push({
    code: "E0233",
    kind: "policy-key-type",
    message: `A latest-per-key key of type ${typeToString(type)} is not keyed by its value: ${unkeyedReason(unkeyed)} (see docs/spec/language.md)`,
    pos: key.pos,
  });
}

/** `$1` is the effect's input, and an effect declared `in=Unit` is emitted with none. */
function effectScope(eff: EffectDef, sym: SymbolTable): Ctx {
  if (declaresNoInput(eff.inType, sym)) return { ...pureScope([]), noInputEffect: eff.name };
  return pureScope([{ name: "$1", type: eff.inType }]);
}

type RequestCheck = {
  readonly cap: string;
  readonly fields: readonly string[];
  readonly sym: SymbolTable;
  readonly errors: KumikiError[];
};

/**
 * Only a literal that lands in the request is checked; a request computed any other way (a `fn`
 * call, a slot, `$1`) has its fields decided at run time. `ctx` is the scope the literal is read
 * in, so a name a `let` or a `match` arm binds has its type there.
 */
function checkRequestFields(e: Expr, req: RequestCheck, ctx: Ctx): void {
  const { cap, fields, sym, errors } = req;
  const field = (name: string, pos: Pos, value: Expr): void => {
    if (fields.includes(name)) {
      const type = requestFieldType(name);
      if (type) checkAgainst(value, type, sym, errors, ctx);
      return;
    }
    const nearest = nearestName(name, fields);
    const hint = nearest === null ? "" : ` — did you mean "${nearest}"?`;
    errors.push({
      code: "E0215",
      kind: "unknown-record-field",
      message: `The ${cap} request has no field "${name}"${hint} (accepted: ${fields.join(", ")})`,
      pos,
    });
  };
  switch (e.kind) {
    case "RecordLit":
      for (const f of e.fields) field(f.name, f.pos, f.value);
      return;
    case "MapLit":
      for (const ent of e.entries) {
        if (ent.key.kind === "Str") field(ent.key.value, ent.key.pos, ent.value);
      }
      return;
    case "IfExpr":
      checkRequestFields(e.consequent, req, ctx);
      checkRequestFields(e.alternate, req, ctx);
      return;
    case "LetIn":
      checkRequestFields(e.body, req, letInScope(e, sym, ctx));
      return;
    case "MatchExpr": {
      const scrutType = matchedType(inferType(e.scrutinee, sym, ctx), e.arms, sym);
      for (const arm of e.arms)
        checkRequestFields(arm.body, req, armScope(arm, scrutType, sym, ctx));
      return;
    }
    default:
      return;
  }
}

function checkTextFailure(eff: EffectDef, sym: SymbolTable, errors: KumikiError[]): void {
  if (!failsWithText(eff.cap)) return;
  const out = unaliasType(eff.outType, sym);
  if (out?.kind !== "TypeApp" || out.name !== "Result" || out.args.length !== 2) return;
  const [ok, declared] = out.args;
  const e = declared ? unaliasType(declared, sym) : null;
  if (!ok || !declared || (e?.kind === "TypePrim" && e.name === "Text")) return;
  errors.push({
    code: "E0306",
    kind: "err-type-not-text",
    message: `effect "${eff.name}" with cap=${eff.cap} declares its error as ${typeToString(declared)}, but ${eff.cap} delivers a failure as its message, a Text — declare out=Result(${typeToString(ok)}, Text)`,
    pos: eff.pos,
  });
}

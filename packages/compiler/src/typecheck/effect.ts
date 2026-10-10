import { nearestName } from "@kumikijs/runtime/text-distance";
import { typeToString, unaliasType } from "../assignable.ts";
import type { EffectDef, Expr, Pos, TypeExpr } from "../ast.ts";
import { failsWithText, requestFields } from "../capabilities.ts";
import { type KumikiError, pureScope, type SymbolTable } from "./context.ts";
import { checkExpr } from "./expr.ts";
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
    checkExpr(eff.mapRequest, sym, errors, pureScope(["$1"]));
    const fields = requestFields(eff.cap);
    if (fields) checkRequestFields(eff.mapRequest, eff.cap, fields, errors);
  }
  // The key runs at dispatch time, so a name unchecked here fails on the first
  // dispatch rather than at check time.
  if (eff.policy?.kind === "PolLatestKey")
    checkExpr(eff.policy.key, sym, errors, pureScope(["$1"]));
}

/**
 * Only a literal that lands in the request is checked; a request computed any other way (a `fn`
 * call, a slot, `$1`) has its fields decided at run time.
 */
function checkRequestFields(
  e: Expr,
  cap: string,
  fields: readonly string[],
  errors: KumikiError[],
): void {
  const refuse = (name: string, pos: Pos): void => {
    if (fields.includes(name)) return;
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
      for (const f of e.fields) refuse(f.name, f.pos);
      return;
    case "MapLit":
      for (const ent of e.entries) if (ent.key.kind === "Str") refuse(ent.key.value, ent.key.pos);
      return;
    case "IfExpr":
      checkRequestFields(e.consequent, cap, fields, errors);
      checkRequestFields(e.alternate, cap, fields, errors);
      return;
    case "LetIn":
      checkRequestFields(e.body, cap, fields, errors);
      return;
    case "MatchExpr":
      for (const arm of e.arms) checkRequestFields(arm.body, cap, fields, errors);
      return;
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

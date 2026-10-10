import { typeToString, unaliasType } from "../assignable.ts";
import type { EffectDef, Expr, TypeExpr } from "../ast.ts";
import { failsWithText } from "../capabilities.ts";
import { type UnkeyedPart, unkeyedPart } from "../key-representation.ts";
import { type Ctx, type KumikiError, pureScope, type SymbolTable } from "./context.ts";
import { checkExpr } from "./expr.ts";
import { declaresNoInput, inferType } from "./infer.ts";
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
  const input = [{ name: "$1", type: effectInputType(eff, sym) }];
  if (eff.mapRequest) checkExpr(eff.mapRequest, sym, errors, pureScope(input));
  // The key runs at dispatch time, so a name unchecked here fails on the first
  // dispatch rather than at check time.
  if (eff.policy?.kind === "PolLatestKey") {
    const scope = pureScope(input);
    checkExpr(eff.policy.key, sym, errors, scope);
    checkPolicyKeyType(eff.policy.key, sym, scope, errors);
  }
}

const UNKEYED_PART_REASON: Record<UnkeyedPart["part"], string> = {
  Float:
    "a Float, whose NaN is not == to itself and whose NaN, Infinity and -Infinity are one key inside a record, tuple, List or variant",
  File: "a File, and every File is one key",
  Set: "a Set, whose == depends on how it was built",
};

// The dispatcher aborts an in-flight request when another starts under the same key, so a key
// that is one key for two values `==` calls different aborts a request it has no reason to.
function checkPolicyKeyType(key: Expr, sym: SymbolTable, scope: Ctx, errors: KumikiError[]): void {
  const type = inferType(key, sym, scope);
  const unkeyed = unkeyedPart(type, sym);
  if (!type || !unkeyed) return;
  errors.push({
    code: "E0233",
    kind: "policy-key-type",
    message: `A latest-per-key key of type ${typeToString(type)} is not keyed by its value: ${unkeyed.whole ? "it is" : "it holds"} ${UNKEYED_PART_REASON[unkeyed.part]} (see docs/spec/language.md)`,
    pos: key.pos,
  });
}

// An effect emitted with no argument has no `$1` value for a type to describe.
function effectInputType(eff: EffectDef, sym: SymbolTable): TypeExpr | null {
  return declaresNoInput(eff.inType, sym) ? null : eff.inType;
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

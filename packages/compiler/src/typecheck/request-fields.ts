import { nearestName } from "@kumikijs/runtime/text-distance";
import { assignable, typeToString, unaliasType } from "../assignable.ts";
import type { EffectDef, Expr, Pos } from "../ast.ts";
import { type RequestField, requestSchema } from "../capabilities.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { letInScope, type MismatchCode, pushMismatch } from "./expr.ts";
import { inferType } from "./infer.ts";
import { armScope, matchedType } from "./patterns.ts";

type Named = { readonly name: string; readonly pos: Pos; readonly value: Expr };

/**
 * Each record or map literal that lands in the request `e` builds, with the scope it is read in, so
 * a name a `let` or a `match` arm binds has its type there. A request computed any other way (a
 * `fn` call, a slot, `$1`) has its fields decided at run time.
 */
function forEachLiteral(
  e: Expr,
  sym: SymbolTable,
  ctx: Ctx,
  visit: (named: readonly Named[], ctx: Ctx) => void,
): void {
  switch (e.kind) {
    case "RecordLit":
      visit(e.fields, ctx);
      return;
    case "MapLit":
      visit(
        e.entries.flatMap((ent) =>
          ent.key.kind === "Str"
            ? [{ name: ent.key.value, pos: ent.key.pos, value: ent.value }]
            : [],
        ),
        ctx,
      );
      return;
    case "IfExpr":
      forEachLiteral(e.consequent, sym, ctx, visit);
      forEachLiteral(e.alternate, sym, ctx, visit);
      return;
    case "LetIn":
      forEachLiteral(e.body, sym, letInScope(e, sym, ctx), visit);
      return;
    case "MatchExpr": {
      const scrutType = matchedType(inferType(e.scrutinee, sym, ctx), e.arms, sym);
      for (const arm of e.arms)
        forEachLiteral(arm.body, sym, armScope(arm, scrutType, sym, ctx), visit);
      return;
    }
    default:
      return;
  }
}

/** The calls a value is, as written or as a branch it ends in; one a name holds is run time's. */
function writtenCalls(value: Expr): readonly (Expr & { kind: "Call" })[] {
  switch (value.kind) {
    case "Call":
      return [value];
    case "IfExpr":
      return [...writtenCalls(value.consequent), ...writtenCalls(value.alternate)];
    case "LetIn":
      return writtenCalls(value.body);
    case "MatchExpr":
      return value.arms.flatMap((arm) => writtenCalls(arm.body));
    default:
      return [];
  }
}

function refuseCalls(
  field: RequestField,
  value: Expr,
  errors: KumikiError[],
  code: MismatchCode,
): void {
  const { refused } = field;
  if (!refused) return;
  for (const call of writtenCalls(value)) {
    if (!refused.calls.includes(call.callee)) continue;
    pushMismatch(
      errors,
      code,
      `Expected ${refused.takes} but got ${call.callee}: ${refused.why}`,
      call.pos,
    );
  }
}

/** A `map-request`'s literal, held to the fields of the request it builds and their rules. */
export function checkRequestFields(
  e: Expr,
  cap: string,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  // Each literal is held to its own schema: whether it names `key` decides `indexed.read`'s.
  forEachLiteral(e, sym, ctx, (named, scope) => {
    const schema = requestSchema(
      cap,
      named.map((n) => n.name),
    );
    if (!schema) return;
    const { request, fields } = schema;
    const names = fields.map((f) => f.name);
    for (const { name, pos, value } of named) {
      const field = fields.find((f) => f.name === name);
      if (field) {
        if (field.type) checkAgainst(value, field.type, sym, errors, scope);
        refuseCalls(field, value, errors, "E0201");
        continue;
      }
      const nearest = nearestName(name, names);
      const hint = nearest === null ? "" : ` — did you mean "${nearest}"?`;
      errors.push({
        code: "E0215",
        kind: "unknown-record-field",
        message: `The ${request} has no field "${name}"${hint} (accepted: ${names.join(", ")})`,
        pos,
      });
    }
  });
}

/**
 * An emit's argument to an effect with no `map-request`, which goes to the handler as the request.
 * The input's declared type has judged its fields already; what is left is the rules a type does
 * not spell.
 */
export function checkEmittedRequest(
  arg: Expr,
  cap: string,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (requestSchema(cap, []) === undefined) return;
  forEachLiteral(arg, sym, ctx, (named) => {
    const schema = requestSchema(
      cap,
      named.map((n) => n.name),
    );
    for (const { name, value } of named) {
      const field = schema?.fields.find((f) => f.name === name);
      if (field) refuseCalls(field, value, errors, "E0202");
    }
  });
}

/**
 * The input an effect with no `map-request` declares is the request the handler is handed, so a
 * field it declares is held to the type the request gives that field.
 */
export function checkDeclaredRequest(
  eff: EffectDef,
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (eff.mapRequest) return;
  const input = unaliasType(eff.inType, sym);
  if (input?.kind !== "TypeRecord") return;
  const schema = requestSchema(
    eff.cap,
    input.fields.map((f) => f.name),
  );
  if (!schema) return;
  for (const declared of input.fields) {
    const type = schema.fields.find((f) => f.name === declared.name)?.type;
    if (!type || assignable(declared.type, type, sym)) continue;
    pushMismatch(
      errors,
      "E0201",
      `Expected ${typeToString(type)} but got ${typeToString(declared.type)}: with no map-request, effect "${eff.name}"'s input is the ${eff.cap} request`,
      // Through an alias, at the name the effect writes rather than in a definition it shares.
      eff.inType.kind === "TypeRecord" ? declared.type.pos : eff.inType.pos,
    );
  }
}

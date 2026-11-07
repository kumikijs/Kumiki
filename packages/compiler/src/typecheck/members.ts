import { assignable, isOpaque, recordFieldType, unaliasType } from "../assignable.ts";
import type { Expr, FragmentShape, KeyKind, Pos, TypeExpr } from "../ast.ts";
import { FIELD_ACCESS_SHORTCUTS, METHOD_MIN_ARGS } from "../codegen.ts";
import { keyRepresentation } from "../key-representation.ts";
import {
  type FragmentArgument,
  type FragmentPositional,
  type FragmentPositionals,
  fragmentArgument,
  hasMember,
  isReceiver,
  type Receiver,
  receiversOf,
  TYPE_ARGUMENT_OF,
  UNIVERSAL_MEMBERS,
} from "../stdlib-members.ts";
import { STDLIB_TYPES } from "../stdlib-types.ts";
import { bindLocal, type Ctx, innerScope, type KumikiError, type SymbolTable } from "./context.ts";
import { inferType, primFieldType, typeName } from "./infer.ts";

type MemberClass = "field" | "member" | "unknown" | "undecidable";

export function classifyMember(raw: TypeExpr | null, field: string, sym: SymbolTable): MemberClass {
  const t = unaliasType(raw, sym);
  if (!t) return "undecidable";

  if (t.kind === "TypeRecord") {
    if (recordFieldType(t, field) !== null) return "field";
    return UNIVERSAL_MEMBERS.has(field) ? "member" : "unknown";
  }

  const receivers = memberReceivers(raw, t, sym);
  if (receivers === null) return "undecidable";

  if (t.kind === "TypePrim" && primFieldType(t.name, field) !== null) return "field";

  return receivers.some((r) => hasMember(r, field)) ? "member" : "unknown";
}

export function memberReceivers(
  raw: TypeExpr | null,
  t: TypeExpr,
  sym: SymbolTable,
): Receiver[] | null {
  const name = t.kind === "TypePrim" || t.kind === "TypeApp" ? t.name : null;
  if (name === null || !isReceiver(name)) return null;
  return isStdlibDuration(raw, sym) ? [name, "Duration"] : [name];
}

export function receiverName(raw: TypeExpr | null, t: TypeExpr, sym: SymbolTable): string {
  return isStdlibDuration(raw, sym) ? "Duration" : typeName(t, sym);
}

const STDLIB_DURATION = STDLIB_TYPES.find((d) => d.name === "Duration");

function isStdlibDuration(t: TypeExpr | null, sym: SymbolTable): boolean {
  const seen = new Set<string>();
  let cur = t;
  while (cur !== null) {
    if (cur.kind === "TypeRefinement" || cur.kind === "TypeNominal") {
      cur = cur.inner;
      continue;
    }
    if (cur.kind !== "TypeRef" || seen.has(cur.name)) return false;
    const def = sym.types.get(cur.name);
    if (def === undefined) return false;
    if (def === STDLIB_DURATION) return true;
    seen.add(cur.name);
    cur = def.body;
  }
  return false;
}

export function undefMemberError(
  raw: TypeExpr | null,
  t: TypeExpr,
  field: string,
  pos: Pos,
  sym: SymbolTable,
): KumikiError {
  const head =
    t.kind === "TypeRecord"
      ? `Record type has no field or method ".${field}"`
      : `Type "${receiverName(raw, t, sym)}" has no member ".${field}"`;
  const owners = receiversOf(field);
  return {
    code: "E0108",
    kind: "undef-member",
    message: owners.length > 0 ? `${head} — it is a member of ${owners.join(" / ")}` : head,
    pos,
  };
}

const KEY_READERS: Readonly<Record<string, ReadonlySet<string>>> = {
  Set: new Set(["to-list", "filter"]),
  Map: new Set(["keys", "entries", "filter", "map"]),
};

export const KEY_READER_NAMES: ReadonlySet<string> = new Set(
  Object.values(KEY_READERS).flatMap((names) => [...names]),
);

export function keyKindOfReader(
  recv: TypeExpr | null,
  member: string,
  sym: SymbolTable,
): KeyKind | undefined {
  const t = unaliasType(recv, sym);
  if (t?.kind !== "TypeApp" || !KEY_READERS[t.name]?.has(member)) return undefined;
  const rep = keyRepresentation(t.args[0] ?? null, sym);
  return rep === "text" || rep === null ? undefined : rep;
}

// The type parameter each receiver stores as object keys, which its `filter` / `map` hands the
// fragment as an entry's key: a Map's key, and a Set's member, whose entry's value is `true`.
const KEYED: ReadonlyMap<string, FragmentPositional> = new Map([
  ["Map", "K"],
  ["Set", "T"],
]);

export function fragmentBindings(
  recv: TypeExpr | null,
  call: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  ctx: Ctx,
): [TypeExpr | null, TypeExpr | null] {
  const found = fragmentRow(recv, call.method, sym);
  if (found === null) return [null, null];
  const { row, app } = found;
  if (row.length === 2) {
    return [
      positionalType(row[0], app, call, sym, ctx),
      positionalType(row[1], app, call, sym, ctx),
    ];
  }
  const only = positionalType(row[0], app, call, sym, ctx);
  return found.fragment.second === "pair-value" && !KEYED.has(app.name)
    ? pairOrElement(only, sym)
    : [only, null];
}

/**
 * `fold`'s accumulator: the wider of `init`, the init's type, and what `body` answers with `$1` of
 * that type, so an `Int` init the fragment answers a `Float` from is a `Float` accumulator. A
 * result that fits neither way leaves it the init's, which the result is then checked against. An
 * init with no type leaves it none.
 */
export function accumulatorType(
  init: TypeExpr | null,
  elem: TypeExpr | null,
  body: Expr,
  sym: SymbolTable,
  ctx: Ctx,
): TypeExpr | null {
  if (init === null) return null;
  const first = innerScope(ctx);
  bindLocal(first, "$1", init);
  bindLocal(first, "$2", elem);
  const result = inferType(body, sym, first);
  const widens = result !== null && !assignable(result, init, sym) && assignable(init, result, sym);
  return widens ? result : init;
}

function fragmentRow(
  recv: TypeExpr | null,
  method: string,
  sym: SymbolTable,
): {
  fragment: FragmentArgument;
  app: TypeExpr & { kind: "TypeApp" };
  row: FragmentPositionals;
} | null {
  const fragment = fragmentArgument(method);
  const app = unaliasType(recv, sym);
  if (fragment === undefined || app?.kind !== "TypeApp") return null;
  const rows: Readonly<Record<string, FragmentPositionals | undefined>> = fragment.on;
  const row = Object.hasOwn(rows, app.name) ? rows[app.name] : undefined;
  return row === undefined ? null : { fragment, app, row };
}

/**
 * A key is typed only when it reads back as a value of its type: a type parameter
 * or a `Bytes` key is handed over as the string it is stored under. `{}` as a
 * fold's init infers to nothing, being the empty Map and the empty Set alike.
 */
function positionalType(
  p: FragmentPositional,
  app: TypeExpr & { kind: "TypeApp" },
  call: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  ctx: Ctx,
): TypeExpr | null {
  if (p === "Acc") {
    const init = call.args[0];
    return init === undefined ? null : inferType(init, sym, ctx);
  }
  const arg = app.args[TYPE_ARGUMENT_OF[p]] ?? null;
  return KEYED.get(app.name) === p && keyRepresentation(arg, sym) === null ? null : arg;
}

export function fragmentShape(
  recv: TypeExpr | null,
  call: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  ctx: Ctx,
): FragmentShape | null {
  if (isOpaque(recv, sym)) return "undecided";
  const found = fragmentRow(recv, call.method, sym);
  if (found === null || found.fragment.second !== "pair-value") return null;
  const { row } = found;
  if (row.length === 2) return "key-value";
  if (KEYED.has(found.app.name)) return "key";
  return elementShape(positionalType(row[0], found.app, call, sym, ctx), sym).shape;
}

function elementShape(
  elem: TypeExpr | null,
  sym: SymbolTable,
):
  | { shape: "pair"; halves: [TypeExpr | null, TypeExpr | null] }
  | { shape: "value" | "undecided" } {
  const u = unaliasType(elem, sym);
  if (u === null || u.kind === "TypeRef") return { shape: "undecided" };
  if (u.kind === "TypeApp" && u.name === "Tuple" && u.args.length === 2) {
    return { shape: "pair", halves: [u.args[0] ?? null, u.args[1] ?? null] };
  }
  return { shape: "value" };
}

/** `$1` / `$2` for a fragment handed `elem`, typed the way {@link elementShape} binds them. */
function pairOrElement(
  elem: TypeExpr | null,
  sym: SymbolTable,
): [TypeExpr | null, TypeExpr | null] {
  const el = elementShape(elem, sym);
  if (el.shape === "pair") return el.halves;
  return el.shape === "value" ? [elem, null] : [null, null];
}

export function classifyFieldAccess(
  e: Expr & { kind: "FieldAccess" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const raw = inferType(e.base, sym, ctx);
  const t = unaliasType(raw, sym);
  if (!t) return; // dynamic — keep name-based shortcut dispatch, no diagnostic

  switch (classifyMember(raw, e.field, sym)) {
    case "field":
      e.accessKind = "field";
      return;

    case "member": {
      const min = METHOD_MIN_ARGS.get(e.field);
      if (min !== undefined && !FIELD_ACCESS_SHORTCUTS.has(e.field)) {
        errors.push({
          code: "E0213",
          kind: "call-arity-mismatch",
          message: `Method ".${e.field}" expects ${min} argument(s) but got 0`,
          pos: e.pos,
        });
        return;
      }
      e.accessKind = "shortcut";
      const kind = keyKindOfReader(t, e.field, sym);
      if (kind) e.keyKind = kind;
      return;
    }

    case "unknown":
      errors.push(undefMemberError(raw, t, e.field, e.pos, sym));
      return;

    case "undecidable":
      // A union or an opaque type param → leave as shortcut, no diagnostic.
      return;
  }
}

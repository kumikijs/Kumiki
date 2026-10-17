import { isOpaque, recordFieldType, unaliasType } from "../assignable.ts";
import type { Expr, FragmentShape, KeyKind, Pos, TypeExpr } from "../ast.ts";
import {
  FIELD_ACCESS_SHORTCUTS,
  FRAGMENT_ARGUMENTS,
  type FragmentArgument,
  type FragmentPositional,
  METHOD_MIN_ARGS,
} from "../codegen.ts";
import { keyRepresentation } from "../key-representation.ts";
import {
  hasMember,
  isReceiver,
  type Receiver,
  receiversOf,
  UNIVERSAL_MEMBERS,
} from "../stdlib-members.ts";
import { STDLIB_TYPES } from "../stdlib-types.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { inferType, PRIM_FIELDS, typeName } from "./infer.ts";

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

  if (t.kind === "TypePrim" && PRIM_FIELDS[t.name]?.[field]) return "field";

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
  Set: new Set(["to-list"]),
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

export function fragmentBindings(
  recv: TypeExpr | null,
  call: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  ctx: Ctx,
): [TypeExpr | null, TypeExpr | null] {
  const found = fragmentRow(recv, call.method, sym);
  if (found === null) return [null, null];
  const [first = null, second = null] = found.row.map((p) =>
    positionalType(p, found.app, call, sym, ctx),
  );
  if (found.fragment.second !== "pair-value" || found.row.length !== 1) return [first, second];
  return first === null ? [null, null] : pairOrElement(first, sym);
}

function fragmentRow(
  recv: TypeExpr | null,
  method: string,
  sym: SymbolTable,
): {
  fragment: FragmentArgument;
  app: TypeExpr & { kind: "TypeApp" };
  row: readonly FragmentPositional[];
} | null {
  const fragment = FRAGMENT_ARGUMENTS.get(method);
  const app = unaliasType(recv, sym);
  if (fragment === undefined || app?.kind !== "TypeApp") return null;
  const rows: Readonly<Record<string, readonly FragmentPositional[] | undefined>> = fragment.on;
  const row = Object.hasOwn(rows, app.name) ? rows[app.name] : undefined;
  return row === undefined ? null : { fragment, app, row };
}

/**
 * A key is typed only when it reads back as a value of `K`: a type parameter or
 * a `Bytes` key is handed over as the string it is stored under. `{}` as a
 * fold's init infers to nothing, being the empty Map and the empty Set alike.
 */
function positionalType(
  p: FragmentPositional,
  app: TypeExpr & { kind: "TypeApp" },
  call: Expr & { kind: "MethodCall" },
  sym: SymbolTable,
  ctx: Ctx,
): TypeExpr | null {
  const [first = null, second = null] = app.args;
  switch (p) {
    case "T":
      return first;
    case "K":
      return keyRepresentation(first, sym) === null ? null : first;
    case "V":
    case "E":
      return second;
    case "Acc": {
      const init = call.args[0];
      return init === undefined ? null : inferType(init, sym, ctx);
    }
  }
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
  const [only, more] = found.row;
  if (only === undefined) return null;
  if (more !== undefined) return "key-value";
  return elementShape(positionalType(only, found.app, call, sym, ctx), sym).shape;
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
function pairOrElement(elem: TypeExpr, sym: SymbolTable): [TypeExpr | null, TypeExpr | null] {
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

import { assignable, typeToString, unaliasType } from "../assignable.ts";
import { type TileExpr, writtenProp } from "../ast.ts";
import { INPUT_BIND_TYPES, inputBindBase } from "../input-bind.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { pushMismatch } from "./expr.ts";
import { inferType, prim } from "./infer.ts";

const BIND_CONTROLS = new Set([
  "input",
  "textarea",
  "select",
  "slider",
  "check",
  "switch",
  "radio",
  "editable",
]);

export function checkBindTargetSteps(
  t: TileExpr & { kind: "TileCall" },
  errors: KumikiError[],
): void {
  let cur = writtenProp(t, "bind")?.value;
  while (cur && (cur.kind === "FieldAccess" || cur.kind === "MethodCall" || cur.kind === "Index")) {
    if (cur.kind === "MethodCall") {
      const hint =
        cur.method === "get" && cur.args.length === 0
          ? ' — the unwrap step is written ".get"'
          : " — a member derives a value, so there is no place in the receiver for the control to write";
      errors.push({
        code: "E0602",
        kind: "unassignable-member",
        message: `Cannot bind through ".${cur.method}(${cur.args.length === 0 ? "" : "…"})": a bind target is a path, and a call is not a step of one${hint}`,
        pos: cur.pos,
      });
    }
    cur = cur.kind === "MethodCall" ? cur.receiver : cur.base;
  }
}

export function checkBindStrictProp(
  t: TileExpr & { kind: "TileCall" },
  errors: KumikiError[],
): void {
  if (!BIND_CONTROLS.has(t.name)) return;
  const written = [
    ...t.args.flatMap((a) => (a.name === "strict" ? [{ pos: a.namePos }] : [])),
    ...t.props.flatMap((p) => (p.name === "strict" ? [{ pos: p.pos }] : [])),
  ];
  for (const { pos } of written) {
    errors.push({
      code: "E0219",
      kind: "bind-strict-prop",
      message: `"strict" is not a prop of ${t.name}: a value its refinement refuses is always refused, and error(field=…) shows why (see docs/spec/forms.md)`,
      pos,
    });
  }
}

const TOGGLE_BIND_CONTROLS = new Set(["check", "switch", "radio"]);

/** The prop each toggle reads for its selection when it has no `bind`. */
const TOGGLE_UNBOUND_SELECTION: Readonly<Record<string, string>> = {
  check: "value",
  switch: "value",
  radio: "selected",
};

export function checkToggleBind(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (!TOGGLE_BIND_CONTROLS.has(t.name)) return;
  const bind = writtenProp(t, "bind");
  if (!bind) return;
  const bindExpr = bind.value;
  const unread = TOGGLE_UNBOUND_SELECTION[t.name];
  const unreadProp = unread === undefined ? undefined : writtenProp(t, unread);
  if (unreadProp) {
    errors.push({
      code: "W0216",
      kind: "selection-beside-bind",
      severity: "warning",
      message: `"${unread}" on ${t.name}() is not read beside bind= — the bound value decides whether it is ${t.name === "radio" ? "chosen" : "ticked"}. Remove it (see docs/spec/forms.md)`,
      pos: unreadProp.namePos,
    });
  }
  const value = t.name === "radio" ? writtenProp(t, "value") : undefined;
  if (t.name === "radio" && !value) {
    errors.push({
      code: "E0225",
      kind: "radio-bind-without-value",
      message: `radio(bind=…) has no value= — a bound radio writes its own value when it is chosen, so it needs one (see docs/spec/forms.md)`,
      pos: bind.namePos,
    });
  }
  const bound = inferType(bindExpr, sym, ctx);
  if (bound === null) return;
  if (t.name === "radio") {
    if (value) checkAgainst(value.value, bound, sym, errors, ctx);
    return;
  }
  if (assignable(bound, prim("Bool", bindExpr.pos), sym)) return;
  pushMismatch(
    errors,
    "E0201",
    `${t.name}(bind=…) writes a Bool, but the bound value is ${typeToString(bound)} (see docs/spec/forms.md)`,
    bindExpr.pos,
  );
}

export function checkInputBindType(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (t.name !== "input") return;
  const bind = writtenProp(t, "bind")?.value;
  if (!bind) return;
  const typeExpr = writtenProp(t, "type")?.value;
  const literal = typeExpr === undefined ? "text" : typeExpr.kind === "Str" ? typeExpr.value : null;
  if (literal === "file") return;
  const bound = inferType(bind, sym, ctx);
  const u = unaliasType(bound, sym);
  if (!u || u.kind === "TypeRef") return;
  const base = u.kind === "TypePrim" ? inputBindBase(u.name) : null;
  if (base !== null && (literal === null || INPUT_BIND_TYPES[base].includes(literal))) return;
  const typeName = bound ? typeToString(bound) : "?";
  const see = "(see docs/spec/forms.md)";
  if (base === null) {
    const payload =
      u.kind === "TypeApp" && (u.name === "Option" || u.name === "Result")
        ? ` — bind its payload with ".get"`
        : "";
    errors.push({
      code: "E0226",
      kind: "input-bind-type",
      message: `input(bind=…) cannot bind a value of type ${typeName}: an input binds a Text, Int, Float or Time${payload} ${see}`,
      pos: bind.pos,
    });
    return;
  }
  const field = typeExpr === undefined ? `no type= (a "text" field)` : `type="${literal}"`;
  const kinds = INPUT_BIND_TYPES[base].map((v) => `type="${v}"`).join(" / ");
  errors.push({
    code: "E0226",
    kind: "input-bind-type",
    message: `input(bind=…) with ${field} cannot bind a value of type ${typeName}: ${base === "Int" ? "an" : "a"} ${base} binds with ${kinds} ${see}`,
    pos: typeExpr !== undefined ? typeExpr.pos : bind.pos,
  });
}

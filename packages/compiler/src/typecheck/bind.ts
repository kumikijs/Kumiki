import { assignable, typeToString, unaliasType } from "../assignable.ts";
import { type Expr, isTileExpr, type TileExpr } from "../ast.ts";
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
  const bind = t.args.find((a) => a.name === "bind");
  let cur = bind?.value as Expr | undefined;
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

/** The argument each toggle reads for its selection when it has no `bind=`. */
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
  const bindArg = t.args.find((a) => a.name === "bind");
  if (!bindArg || isTileExpr(bindArg.value)) return;
  const bindExpr = bindArg.value;
  const unread = TOGGLE_UNBOUND_SELECTION[t.name];
  for (const arg of t.args) {
    if (arg.name !== unread) continue;
    errors.push({
      code: "W0216",
      kind: "selection-beside-bind",
      severity: "warning",
      message: `"${unread}" on ${t.name}() is not read beside bind= — the bound value decides whether it is ${t.name === "radio" ? "chosen" : "ticked"}. Remove it (see docs/spec/forms.md)`,
      pos: arg.namePos ?? (arg.value as Expr).pos,
    });
  }
  const valueArg = t.name === "radio" ? t.args.find((a) => a.name === "value") : undefined;
  if (t.name === "radio" && !valueArg) {
    errors.push({
      code: "E0225",
      kind: "radio-bind-without-value",
      message: `radio(bind=…) has no value= — a bound radio writes its own value when it is chosen, so it needs one (see docs/spec/forms.md)`,
      pos: bindArg.namePos ?? bindExpr.pos,
    });
  }
  const bound = inferType(bindExpr, sym, ctx);
  if (bound === null) return;
  if (t.name === "radio") {
    if (valueArg && !isTileExpr(valueArg.value)) {
      checkAgainst(valueArg.value, bound, sym, errors, ctx);
    }
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
  const bindArg = t.args.find((a) => a.name === "bind");
  if (!bindArg || isTileExpr(bindArg.value)) return;
  const typeArg = t.args.find((a) => a.name === "type")?.value;
  const literal =
    typeArg === undefined
      ? "text"
      : !isTileExpr(typeArg) && typeArg.kind === "Str"
        ? typeArg.value
        : null;
  if (literal === "file") return;
  const bound = inferType(bindArg.value, sym, ctx);
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
      pos: bindArg.value.pos,
    });
    return;
  }
  const field = typeArg === undefined ? `no type= (a "text" field)` : `type="${literal}"`;
  const kinds = INPUT_BIND_TYPES[base].map((v) => `type="${v}"`).join(" / ");
  errors.push({
    code: "E0226",
    kind: "input-bind-type",
    message: `input(bind=…) with ${field} cannot bind a value of type ${typeName}: ${base === "Int" ? "an" : "a"} ${base} binds with ${kinds} ${see}`,
    pos: typeArg !== undefined && !isTileExpr(typeArg) ? typeArg.pos : bindArg.value.pos,
  });
}

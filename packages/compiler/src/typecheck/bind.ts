import { assignable, typeToString, unaliasType } from "../assignable.ts";
import { type Expr, isTileExpr, type Pos, type TileExpr } from "../ast.ts";
import { bindTarget } from "../bind-target.ts";
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
  if (!bind || isTileExpr(bind.value)) return;
  for (const step of bindTarget(bind.value).steps) {
    if (step.kind !== "MethodCall") continue;
    const hint =
      step.method === "get" && step.args.length === 0
        ? ' — the unwrap step is written ".get"'
        : " — a member derives a value, so there is no place in the receiver for the control to write";
    errors.push({
      code: "E0602",
      kind: "unassignable-member",
      message: `Cannot bind through ".${step.method}(${step.args.length === 0 ? "" : "…"})": a bind target is a path, and a call is not a step of one${hint}`,
      pos: step.pos,
    });
  }
}

/**
 * A local's name is not in the slot table, so a write lands under it where
 * nothing reads it; a literal or computed root gives the lowering no name, and
 * it drops the bind. `route` is a slot, but only navigation moves it.
 */
export function checkBindTargetRoot(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (!BIND_CONTROLS.has(t.name)) return;
  const bindArg = t.args.find((a) => a.name === "bind");
  if (!bindArg || isTileExpr(bindArg.value)) return;
  // A file input takes no bind at all, and E0205 says so whatever the target names.
  if (isFileInput(t)) return;
  const root = bindRootNotASlot(bindTarget(bindArg.value).root, sym, ctx);
  if (!root) return;
  errors.push({
    code: "E0229",
    kind: "bind-target-not-slot",
    message: `${t.name}(bind=…) cannot write to ${root.named}: ${root.is}. ${root.fix} (see docs/spec/${root.see})`,
    pos: bindArg.value.pos,
  });
}

function isFileInput(t: TileExpr & { kind: "TileCall" }): boolean {
  if (t.name !== "input") return false;
  const type = t.args.find((a) => a.name === "type")?.value;
  return type !== undefined && !isTileExpr(type) && type.kind === "Str" && type.value === "file";
}

type RootReport = { named: string; is: string; fix: string; see: string };

const notASlot = (named: string, is: string, fix: string): RootReport => ({
  named,
  is: `${is}, not a slot — a bind writes back to a slot or a field path into one`,
  fix,
  see: "forms.md",
});

function bindRootNotASlot(root: Expr, sym: SymbolTable, ctx: Ctx): RootReport | null {
  const fix = "Bind a slot, or show the value with value= and write the slot from a reducer";
  switch (root.kind) {
    case "Ref": {
      const named = `"${root.name}"`;
      if (ctx.localBinds.has(root.name)) {
        switch (ctx.localBinders.get(root.name)) {
          case "for":
            return notASlot(
              named,
              "it is the variable of a for",
              "To edit a row, show it with value= and update the list from a reducer",
            );
          case "input":
            return notASlot(
              named,
              "it is this tile's input",
              `Bind the slot by its name, or show ${root.name} with value= and write the slot from a reducer`,
            );
          default:
            return notASlot(named, "it is a local name", fix);
        }
      }
      if (sym.slots.has(root.name) || root.name !== "route") return null;
      return {
        named,
        is: "it is the route slot, which only navigation writes",
        fix: "Move it with link(to=…) or emit navigate(…)",
        see: "routing.md",
      };
    }
    case "Str":
      // Unquoted, a name a local hides is that local, which is no slot either.
      return notASlot(
        `the text literal ${JSON.stringify(root.value)}`,
        "a literal is a value",
        sym.slots.has(root.value) && !ctx.localBinds.has(root.value)
          ? `Write the slot's name without quotes: bind=${root.value}`
          : fix,
      );
    case "Num":
    case "Bool":
      return notASlot(
        `the literal ${root.kind === "Num" ? (root.raw ?? root.value) : root.value}`,
        "a literal is a value",
        fix,
      );
    default:
      return notASlot("this expression", "it computes a value", fix);
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

/** Where `t` writes `name`, as a named argument or in its props block. */
function writtenAt(t: TileExpr & { kind: "TileCall" }, name: string): Pos[] {
  return [
    ...t.args.flatMap((a) => (a.name === name ? [a.namePos] : [])),
    ...t.props.flatMap((p) => (p.name === name ? [p.pos] : [])),
  ];
}

/**
 * A slider's `value` is the value an unbound slider shows, so beside `bind=` it is a second answer to what the slider shows (W0216, as on a toggle).
 * A radio's `name` spells its `group`, so beside `group` it is a second answer to which set the radio is in (W0217).
 */
export function checkSecondSpelling(
  t: TileExpr & { kind: "TileCall" },
  errors: KumikiError[],
): void {
  if (t.name === "slider" && t.args.some((a) => a.name === "bind")) {
    for (const pos of writtenAt(t, "value")) {
      errors.push({
        code: "W0216",
        kind: "selection-beside-bind",
        severity: "warning",
        message: `"value" on slider() is not read beside bind= — the bound value is what it shows. Remove it (see docs/spec/forms.md)`,
        pos,
      });
    }
  }
  if (t.name === "radio" && writtenAt(t, "group").length > 0) {
    for (const pos of writtenAt(t, "name")) {
      errors.push({
        code: "W0217",
        kind: "name-beside-group",
        severity: "warning",
        message: `"name" on radio() is not read beside group= — group= names the set the radio is in. Remove one (see docs/spec/forms.md)`,
        pos,
      });
    }
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

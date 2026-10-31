import { assignable, typeToString, unaliasType } from "../assignable.ts";
import {
  type Expr,
  isTileExpr,
  numberLiteral,
  type Pos,
  type TileExpr,
  type TypeExpr,
} from "../ast.ts";
import { bindTarget } from "../bind-target.ts";
import { errorField, fieldSegment } from "../error-field.ts";
import { INPUT_BIND_TYPES, inputBindBase } from "../input-bind.ts";
import { checkAgainst, checkIndexIsPlace, indexStep, unwrappedType } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { pushMismatch } from "./expr.ts";
import { inferType, prim } from "./infer.ts";
import { classifyMember, receiverName } from "./members.ts";

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
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const bind = t.args.find((a) => a.name === "bind");
  if (!bind || isTileExpr(bind.value)) return;
  for (const step of bindTarget(bind.value).steps) {
    if (step.kind === "Index") {
      checkIndexIsPlace(indexStep(inferType(step.base, sym, ctx), sym), step, "bind", errors);
    }
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
  is: `${is}, not a slot — a bind writes back to a slot or a path into one`,
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
              "To edit a row, bind it through the slot by a Map key or an index the page holds (bind=rows[i].title), or show it with value= and update the list from a reducer",
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

/**
 * Run after the field has been checked as a value, so what that read already
 * reported (E0103, E0127, E0108, E0213, an E0201 or E0232 at a key) is not reported again.
 */
export function checkErrorField(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  if (t.name !== "error") return;
  const see = "(see docs/spec/forms.md)";
  const refuse = (message: string, pos: Pos): void => {
    errors.push({ code: "E0230", kind: "error-field-not-path", message, pos });
  };
  const inBlock = t.props.find((p) => p.name === "field");
  if (inBlock) {
    refuse(
      `error() {field: …} is not read: field is a named argument — write error(field=…) ${see}`,
      inBlock.pos,
    );
  }
  const arg = t.args.find((a) => a.name === "field");
  if (!arg) {
    if (!inBlock) {
      refuse(
        `error() names no field, so it has no failure to show: field= names a slot, or a path into one ${see}`,
        t.pos,
      );
    }
    return;
  }
  const rootProblem = (named: string, is: string, fix?: string): string =>
    `error(field=…) cannot show the failure of ${named}: ${is}. field= names a slot, or a path into one${fix ? ` — ${fix}` : ""} ${see}`;
  if (isTileExpr(arg.value)) {
    const kind = arg.value.kind === "TileFor" ? "for" : "when";
    refuse(rootProblem(`a "${kind}"`, "it is a tile, not a slot"), arg.value.pos);
    return;
  }
  const reported = (pos: Pos): boolean =>
    errors.some(
      (e) => e.severity !== "warning" && e.pos.line === pos.line && e.pos.col === pos.col,
    );
  const field = errorField(arg.value);
  const { root } = field;
  const notASlot = errorFieldRootProblem(root, sym, ctx);
  if (notASlot) {
    if (!reported(root.pos))
      refuse(rootProblem(notASlot.named, notASlot.is, notASlot.fix), root.pos);
    return;
  }
  const steps = `A path's steps are fields, ".get", and indices with a literal key ${see}`;
  // A type the checker cannot decide is reported where it is written (E0117).
  const undecided = (raw: TypeExpr | null): boolean => indexStep(raw, sym).kind === "undecidable";
  // The first step that names no place is the mistake; the steps after it have nothing to step into.
  for (const step of field.steps) {
    if (reported(step.pos)) return;
    switch (step.kind) {
      case "MethodCall":
        refuse(
          `error(field=…) cannot step through ".${step.method}(${step.args.length === 0 ? "" : "…"})": a call is not a step of a path. ${steps}`,
          step.pos,
        );
        return;
      case "Index": {
        if (reported(step.index.pos)) return;
        if (fieldSegment(step) === null) {
          refuse(
            `error(field=…) cannot step through an index that is not a literal: a path names one element or entry by a literal key, such as [0] or ["k"] ${see}`,
            step.index.pos,
          );
          return;
        }
        const at = indexStep(inferType(step.base, sym, ctx), sym);
        if (at.kind === "undecidable") return;
        if (at.kind === "no-place") {
          refuse(
            `error(field=…) cannot step through an index into "${typeToString(at.raw)}": a path's index names a List element or a Map entry ${see}`,
            step.pos,
          );
          return;
        }
        break;
      }
      case "FieldAccess": {
        const raw = inferType(step.base, sym, ctx);
        if (raw === null || undecided(raw)) return;
        const member = classifyMember(raw, step.field, sym);
        if (member === "field") break;
        const base = unaliasType(raw, sym);
        if (step.field === "get" && base && unwrappedType(base) !== null) break;
        // E0108 names a field the record lacks.
        if (member === "unknown") return;
        refuse(
          member === "member" && base
            ? `error(field=…) cannot step through ".${step.field}": it is a member of "${receiverName(raw, base, sym)}", not a field. ${steps}`
            : `error(field=…) cannot step through ".${step.field}": "${typeToString(raw)}" has no fields. ${steps}`,
          step.pos,
        );
        return;
      }
    }
  }
}

/** A local named like a slot hides the slot here, as it does for any read. */
function errorFieldRootProblem(
  root: Expr,
  sym: SymbolTable,
  ctx: Ctx,
): { named: string; is: string; fix?: string } | null {
  const literal = "a literal is a value, not a slot";
  const n = numberLiteral(root);
  if (n) return { named: `the literal ${n.raw}`, is: literal };
  switch (root.kind) {
    case "Ref":
      if (ctx.localBinds.has(root.name)) {
        return { named: `"${root.name}"`, is: "it is a local name, not a slot" };
      }
      if (sym.slots.has(root.name)) return null;
      return root.name === "route"
        ? { named: `"route"`, is: "it is the route slot, whose type carries no refinement to fail" }
        : { named: `"${root.name}"`, is: "it is not a slot" };
    case "Str": {
      const named = `the text literal ${JSON.stringify(root.value)}`;
      return sym.slots.has(root.value) && !ctx.localBinds.has(root.value)
        ? {
            named,
            is: literal,
            fix: `write the slot's name without quotes: error(field=${root.value})`,
          }
        : { named, is: literal };
    }
    case "Bool":
      return { named: `the literal ${root.value}`, is: literal };
    default:
      return { named: "this expression", is: "it computes a value, not a slot" };
  }
}

import { isOpaque, recordFieldType, typeToString, unaliasType } from "../assignable.ts";
import type { Expr, TileExpr, TypeExpr } from "../ast.ts";
import { builtinPropType, OPTION_SPELLING, PROP_TYPE_SPELLING } from "../builtin-props.ts";
import { contentArg } from "../builtins.ts";
import { checkAgainst } from "./against.ts";
import type { Ctx, KumikiError, SymbolTable } from "./context.ts";
import { pushMismatch } from "./expr.ts";
import { inferType, prim } from "./infer.ts";
import { writtenValue } from "./tile-collect.ts";

const BUTTON_TYPES = new Set(["submit", "button", "reset"]);

export function checkButtonType(t: TileExpr & { kind: "TileCall" }, errors: KumikiError[]): void {
  if (t.name !== "button") return;
  const arg = t.args.find((a) => a.name === "type");
  if (!arg) return;
  const v = arg.value as Expr;
  if (v.kind !== "Str" || BUTTON_TYPES.has(v.value)) return;
  errors.push({
    code: "E0201",
    kind: "type-mismatch",
    message: `button type="${v.value}" is not one of submit / button / reset; an invalid type submits`,
    pos: v.pos,
  });
}

export function checkIconName(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (t.name !== "icon") return;
  const nameArg = contentArg(t);
  if (!nameArg) return;
  const v = nameArg.value as Expr;
  if (v.kind !== "Str") return;
  const literal = v.value;
  if (!literal) return;
  if (sym.iconDomain.has(literal)) return;
  errors.push({
    code: "E0704",
    kind: "unknown-icon",
    message: `Unknown icon name "${literal}" — not in @kumikijs/icons or any theme.icons block`,
    pos: v.pos,
  });
}

export function checkA11y(
  t: TileExpr & { kind: "TileCall" },
  sym: SymbolTable,
  errors: KumikiError[],
): void {
  if (t.name === "label") {
    const forProp = writtenValue(t, "for");
    if (forProp?.kind === "Str" && !sym.elementIds.has(forProp.value)) {
      errors.push({
        code: "E0705",
        kind: "a11y-label-for",
        message: `label for="${forProp.value}" names no tile — no id="${forProp.value}" in this program`,
        pos: forProp.pos,
      });
    }
  }
  if (t.name === "button") {
    const hasText = t.args.some((a) => a.name === "text");
    const hasAria = t.props.some((p) => p.name === "aria-label");
    if (!hasText && !hasAria) {
      errors.push({
        code: "E0701",
        kind: "a11y-button",
        message: `button must have a text= argument or aria-label prop`,
        pos: t.pos,
      });
    }
  }
  if (t.name === "image") {
    const hasAlt = t.args.some((a) => a.name === "alt") || t.props.some((p) => p.name === "alt");
    if (!hasAlt) {
      errors.push({
        code: "E0702",
        kind: "a11y-image",
        message: `image must have an alt prop`,
        pos: t.pos,
      });
    }
  }
  if (t.name === "link") {
    const hasText = contentArg(t) !== undefined || t.props.some((p) => p.name === "text");
    const hasAria = t.props.some((p) => p.name === "aria-label");
    if (!hasText && !hasAria) {
      errors.push({
        code: "E0703",
        kind: "a11y-link",
        message: `link must have inner text or aria-label`,
        pos: t.pos,
      });
    }
  }
}

// Asked of the named argument and the `{…}` block alike: `modal(open=…)` and `modal() {open: …}` are one prop.
export function checkBuiltinProp(
  tile: string,
  prop: string,
  value: Expr,
  sym: SymbolTable,
  errors: KumikiError[],
  ctx: Ctx,
): void {
  const want = builtinPropType(tile, prop);
  if (want === undefined) return;
  if (want === "Options") {
    checkSelectOptions(value, sym, errors, ctx);
    return;
  }
  checkAgainst(value, prim(want, value.pos), sym, errors, ctx);
}

// Not `checkAgainst` against a record type: an option may carry fields beyond `label` and `value`,
// which a record type would refuse. A literal is judged entry by entry, so the report lands on the
// entry that is wrong.
function checkSelectOptions(value: Expr, sym: SymbolTable, errors: KumikiError[], ctx: Ctx): void {
  if (value.kind === "ListLit") {
    for (const item of value.items) {
      const t = inferType(item, sym, ctx);
      if (t === null || isOpaque(t, sym) || isOptionRecord(t, sym)) continue;
      pushMismatch(
        errors,
        "E0201",
        `Expected ${OPTION_SPELLING} but got ${typeToString(t)}`,
        item.pos,
      );
    }
    return;
  }
  const t = inferType(value, sym, ctx);
  if (t === null || isOpaque(t, sym)) return;
  const list = unaliasType(t, sym);
  const elem =
    list?.kind === "TypeApp" && list.name === "List" ? (list.args[0] ?? null) : undefined;
  if (elem !== undefined && (isOpaque(elem, sym) || isOptionRecord(elem, sym))) return;
  pushMismatch(
    errors,
    "E0201",
    `Expected ${PROP_TYPE_SPELLING.Options} but got ${typeToString(t)}`,
    value.pos,
  );
}

function isOptionRecord(t: TypeExpr | null, sym: SymbolTable): boolean {
  const u = unaliasType(t, sym);
  return (
    u?.kind === "TypeRecord" &&
    recordFieldType(u, "label") !== null &&
    recordFieldType(u, "value") !== null
  );
}

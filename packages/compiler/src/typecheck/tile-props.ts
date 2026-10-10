import type { Expr, TileExpr } from "../ast.ts";
import { contentArg } from "../builtins.ts";
import type { KumikiError, SymbolTable } from "./context.ts";
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

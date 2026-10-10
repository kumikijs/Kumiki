import type { Expr } from "../ast.ts";

export function walkExpr(e: Expr | undefined, visit: (n: Expr) => void): void {
  if (!e) return;
  visit(e);
  switch (e.kind) {
    case "BinOp":
      walkExpr(e.lhs, visit);
      walkExpr(e.rhs, visit);
      return;
    case "UnaryOp":
      walkExpr(e.rhs, visit);
      return;
    case "FieldAccess":
      walkExpr(e.base, visit);
      return;
    case "Index":
      walkExpr(e.base, visit);
      walkExpr(e.index, visit);
      return;
    case "Call":
      for (const a of e.args) walkExpr(a, visit);
      return;
    case "MethodCall":
      walkExpr(e.receiver, visit);
      for (const a of e.args) walkExpr(a, visit);
      return;
    case "RecordLit":
      for (const f of e.fields) walkExpr(f.value, visit);
      return;
    case "ListLit":
    case "TupleLit":
      for (const it of e.items) walkExpr(it, visit);
      return;
    case "MapLit":
      for (const en of e.entries) {
        walkExpr(en.key, visit);
        walkExpr(en.value, visit);
      }
      return;
    case "MatchExpr":
      walkExpr(e.scrutinee, visit);
      for (const arm of e.arms) walkExpr(arm.body, visit);
      return;
    case "IfExpr":
      walkExpr(e.cond, visit);
      walkExpr(e.consequent, visit);
      walkExpr(e.alternate, visit);
      return;
    case "LetIn":
      walkExpr(e.value, visit);
      walkExpr(e.body, visit);
      return;
    case "Variant":
      for (const p of e.payload) walkExpr(p, visit);
      return;
    case "EmitExpr":
      for (const a of e.args) walkExpr(a, visit);
      return;
  }
}

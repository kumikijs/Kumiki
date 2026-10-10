import {
  assertNever,
  type Expr,
  isTileExpr,
  type Lvalue,
  type Pattern,
  type Pos,
  type Statement,
  type TileExpr,
} from "../ast.ts";
import type { NestedScope } from "./context.ts";
import { walkExpr } from "./expr-walk.ts";

/**
 * One place a definition declares a name in a nested scope, and the stretch of source (`from` …
 * `to`) it is declared for. A read inside the stretch is not outside the scope even when it does not
 * resolve: one ahead of the `let` in the same body, or in the list of the `for` or the value of the
 * `let … in` that declares the name, which is read before the name is in scope.
 */
export type ScopedDeclaration = { kind: NestedScope; at: Pos; from: Pos; to: Pos };

export type NestedScopes = ReadonlyMap<string, readonly ScopedDeclaration[]>;

type Extent = { from: Pos; to: Pos };

function comparePos(a: Pos, b: Pos): number {
  return a.line - b.line || a.col - b.col;
}

function spanning(a: Extent, b: Extent | null): Extent {
  if (b === null) return a;
  return {
    from: comparePos(b.from, a.from) < 0 ? b.from : a.from,
    to: comparePos(b.to, a.to) > 0 ? b.to : a.to,
  };
}

function extentAt(pos: Pos): Extent {
  return { from: pos, to: pos };
}

function exprExtent(e: Expr): Extent {
  let over = extentAt(e.pos);
  walkExpr(e, (n) => {
    over = spanning(over, extentAt(n.pos));
  });
  return over;
}

/**
 * Every name the definition made of `roots` declares in a nested scope, and where. Built from the
 * tree before the check rather than as the check goes, because a scope the checker reaches after a
 * read still declares the read's name. The `let` statements of the definition's own body are not in
 * a nested scope, so a statement list given as a root declares none.
 */
export function nestedScopes(
  ...roots: (Expr | TileExpr | Statement[] | undefined)[]
): NestedScopes {
  const table = new Map<string, ScopedDeclaration[]>();
  const declare = (kind: NestedScope, name: string, at: Pos, over: Extent): void => {
    const declaration = { kind, at, ...over };
    const known = table.get(name);
    if (known) known.push(declaration);
    else table.set(name, [declaration]);
  };
  const arm = (kind: NestedScope, pattern: Pattern, body: Extent | null): Extent => {
    const over = spanning(extentAt(pattern.pos), body);
    for (const b of patternBinds(pattern)) declare(kind, b.name, b.pos, over);
    return over;
  };
  const expr = (e: Expr): Extent => {
    walkExpr(e, (n) => {
      if (n.kind === "LetIn") declare("let-in", n.name, n.pos, exprExtent(n));
      if (n.kind === "MatchExpr") {
        for (const a of n.arms) arm("match-expr", a.pattern, exprExtent(a.body));
      }
    });
    return exprExtent(e);
  };
  const lvalue = (lv: Lvalue): Extent => {
    if (lv.kind === "LSlot") return extentAt(lv.pos);
    const base = spanning(extentAt(lv.pos), lvalue(lv.base));
    return lv.kind === "LIndex" ? spanning(base, expr(lv.index)) : base;
  };
  const statements = (stmts: Statement[]): Extent | null =>
    stmts.reduce<Extent | null>((over, s) => {
      const next = statement(s);
      return over === null ? next : spanning(over, next);
    }, null);
  const body = (kind: NestedScope, stmts: Statement[]): Extent | null => {
    const over = statements(stmts);
    if (over !== null) {
      for (const s of stmts) if (s.kind === "LetStmt") declare(kind, s.name, s.pos, over);
    }
    return over;
  };
  const statement = (s: Statement): Extent => {
    const own = extentAt(s.pos);
    switch (s.kind) {
      case "SlotAssign":
        return spanning(spanning(own, lvalue(s.lvalue)), expr(s.rhs));
      case "LetStmt":
        return spanning(own, expr(s.rhs));
      case "Emit":
        return s.args.reduce((over, a) => spanning(over, expr(a)), own);
      case "PanicStmt":
        return spanning(own, expr(s.message));
      case "StopTimer":
      case "NoopStmt":
        return own;
      case "ForStmt": {
        const over = spanning(spanning(own, expr(s.iter)), body("for", s.body));
        declare("for", s.bind, s.pos, over);
        return over;
      }
      case "IfStmt": {
        const consequent = spanning(spanning(own, expr(s.cond)), body("if", s.consequent));
        return spanning(consequent, body("if", s.alternate));
      }
      case "MatchStmt":
        return s.arms.reduce(
          (over, a) => spanning(over, arm("match", a.pattern, body("match", a.body))),
          spanning(own, expr(s.scrutinee)),
        );
      default:
        assertNever(s);
        return own;
    }
  };
  const tile = (t: TileExpr): Extent => {
    const own = extentAt(t.pos);
    switch (t.kind) {
      case "TileCall": {
        let over = own;
        for (const a of t.args) {
          over = spanning(over, isTileExpr(a.value) ? tile(a.value) : expr(a.value));
        }
        for (const p of t.props) over = spanning(spanning(over, extentAt(p.pos)), expr(p.value));
        return over;
      }
      case "TileFor": {
        const over = spanning(spanning(own, expr(t.iter)), tile(t.body));
        declare("for-expr", t.bind, t.pos, over);
        return over;
      }
      case "TileWhen":
        return spanning(spanning(own, expr(t.cond)), tile(t.body));
      case "TileIf":
        return spanning(
          spanning(spanning(own, expr(t.cond)), tile(t.consequent)),
          tile(t.alternate),
        );
      case "TileMatch":
        return t.arms.reduce(
          (over, a) => spanning(over, arm("match-expr", a.pattern, tile(a.body))),
          spanning(own, expr(t.scrutinee)),
        );
      default:
        assertNever(t);
        return own;
    }
  };
  for (const root of roots) {
    if (root === undefined) continue;
    if (Array.isArray(root)) statements(root);
    else if (isTileExpr(root)) tile(root);
    else expr(root);
  }
  return table;
}

/**
 * The nested scope declaring `name` that a read at `pos` is outside of: the one that ended last
 * before the read, or else the first to begin after it. Of two that end together, the outer one,
 * which held the name the longer; of two that begin together, the earlier declaration.
 */
export function scopeOutside(
  scopes: NestedScopes,
  name: string,
  pos: Pos,
): { side: "ended" | "later"; declaration: ScopedDeclaration } | undefined {
  const endsLater = (a: ScopedDeclaration, b: ScopedDeclaration): number =>
    comparePos(a.to, b.to) || comparePos(b.from, a.from);
  const beginsSooner = (a: ScopedDeclaration, b: ScopedDeclaration): number =>
    comparePos(b.from, a.from) || comparePos(b.at, a.at);
  let ended: ScopedDeclaration | undefined;
  let later: ScopedDeclaration | undefined;
  for (const d of scopes.get(name) ?? []) {
    if (comparePos(d.to, pos) < 0) {
      if (ended === undefined || endsLater(d, ended) > 0) ended = d;
    } else if (comparePos(pos, d.from) < 0) {
      if (later === undefined || beginsSooner(d, later) > 0) later = d;
    }
  }
  if (ended !== undefined) return { side: "ended", declaration: ended };
  if (later !== undefined) return { side: "later", declaration: later };
  return undefined;
}

/** A variant's binds have no position of their own, so they are placed at the variant pattern. */
export function patternBinds(pat: Pattern): { name: string; pos: Pos }[] {
  switch (pat.kind) {
    case "PWildcard":
      return [];
    case "PBind":
      return pat.name === "_" ? [] : [{ name: pat.name, pos: pat.pos }];
    case "PVariant":
      return pat.binds.filter((b) => b !== "_").map((name) => ({ name, pos: pat.pos }));
    case "PTuple":
      return pat.items.flatMap(patternBinds);
    default:
      assertNever(pat);
      return [];
  }
}

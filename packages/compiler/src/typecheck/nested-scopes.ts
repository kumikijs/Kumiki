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
import type { NestedScopeKind } from "./context.ts";
import { walkExpr } from "./expr-walk.ts";

/**
 * One place a definition declares a name in a nested scope, and where the stretch of source it is
 * declared for begins (`from`). A read before `from` is ahead of the scope. A read past it is not,
 * even when it does not resolve: one ahead of the `let` in the same body, or in the list of the
 * `for` or the value of the `let … in` that declares the name, read before the name is in scope.
 */
export type ScopedDeclaration = { kind: NestedScopeKind; at: Pos; from: Pos };

export type NestedScopes = ReadonlyMap<string, readonly ScopedDeclaration[]>;

function comparePos(a: Pos, b: Pos): number {
  return a.line - b.line || a.col - b.col;
}

function earliest(a: Pos, b: Pos | null): Pos {
  return b !== null && comparePos(b, a) < 0 ? b : a;
}

/** A node's own position is not always its first, so every node in it is looked at. */
function exprStart(e: Expr): Pos {
  let from = e.pos;
  walkExpr(e, (n) => {
    from = earliest(from, n.pos);
  });
  return from;
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
  const declare = (kind: NestedScopeKind, name: string, at: Pos, from: Pos): void => {
    const declaration = { kind, at, from };
    const known = table.get(name);
    if (known) known.push(declaration);
    else table.set(name, [declaration]);
  };
  const arm = (kind: NestedScopeKind, pattern: Pattern, body: Pos | null): Pos => {
    const from = earliest(pattern.pos, body);
    for (const b of patternBinds(pattern)) declare(kind, b.name, b.pos, from);
    return from;
  };
  const expr = (e: Expr): Pos => {
    walkExpr(e, (n) => {
      if (n.kind === "LetIn") declare("let-in", n.name, n.pos, exprStart(n));
      if (n.kind === "MatchExpr") {
        for (const a of n.arms) arm("match-expr", a.pattern, exprStart(a.body));
      }
    });
    return exprStart(e);
  };
  const lvalue = (lv: Lvalue): Pos => {
    if (lv.kind === "LSlot") return lv.pos;
    const base = earliest(lv.pos, lvalue(lv.base));
    return lv.kind === "LIndex" ? earliest(base, expr(lv.index)) : base;
  };
  const statements = (stmts: Statement[]): Pos | null =>
    stmts.reduce<Pos | null>((from, s) => earliest(statement(s), from), null);
  const body = (kind: NestedScopeKind, stmts: Statement[]): Pos | null => {
    const from = statements(stmts);
    if (from !== null) {
      for (const s of stmts) if (s.kind === "LetStmt") declare(kind, s.name, s.pos, from);
    }
    return from;
  };
  const statement = (s: Statement): Pos => {
    const own = s.pos;
    switch (s.kind) {
      case "SlotAssign":
        return earliest(earliest(own, lvalue(s.lvalue)), expr(s.rhs));
      case "LetStmt":
        return earliest(own, expr(s.rhs));
      case "Emit":
        return s.args.reduce((from, a) => earliest(from, expr(a)), own);
      case "PanicStmt":
        return earliest(own, expr(s.message));
      case "StopTimer":
      case "NoopStmt":
        return own;
      case "ForStmt": {
        const from = earliest(earliest(own, expr(s.iter)), body("for", s.body));
        declare("for", s.bind, own, from);
        return from;
      }
      case "IfStmt": {
        const consequent = earliest(earliest(own, expr(s.cond)), body("if", s.consequent));
        return earliest(consequent, body("if", s.alternate));
      }
      case "MatchStmt":
        return s.arms.reduce(
          (from, a) => earliest(from, arm("match", a.pattern, body("match", a.body))),
          earliest(own, expr(s.scrutinee)),
        );
      default:
        assertNever(s);
        return own;
    }
  };
  const tile = (t: TileExpr): Pos => {
    const own = t.pos;
    switch (t.kind) {
      case "TileCall": {
        let from = own;
        for (const a of t.args) {
          from = earliest(from, isTileExpr(a.value) ? tile(a.value) : expr(a.value));
        }
        for (const p of t.props) from = earliest(earliest(from, p.pos), expr(p.value));
        return from;
      }
      case "TileFor": {
        const from = earliest(earliest(own, expr(t.iter)), tile(t.body));
        declare("for-expr", t.bind, own, from);
        return from;
      }
      case "TileWhen":
        return earliest(earliest(own, expr(t.cond)), tile(t.body));
      case "TileIf":
        return earliest(
          earliest(earliest(own, expr(t.cond)), tile(t.consequent)),
          tile(t.alternate),
        );
      case "TileMatch":
        return t.arms.reduce(
          (from, a) => earliest(from, arm("match-expr", a.pattern, tile(a.body))),
          earliest(own, expr(t.scrutinee)),
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
 * The nested scope declaring `name` that begins after a read at `pos`: the first to begin, and of
 * two that begin together, the earlier declaration. A scope that ended before the read is the
 * check's to name, as it goes.
 */
export function laterDeclaration(
  scopes: NestedScopes,
  name: string,
  pos: Pos,
): ScopedDeclaration | undefined {
  const sooner = (a: ScopedDeclaration, b: ScopedDeclaration): number =>
    comparePos(a.from, b.from) || comparePos(a.at, b.at);
  let later: ScopedDeclaration | undefined;
  for (const d of scopes.get(name) ?? []) {
    if (comparePos(pos, d.from) >= 0) continue;
    if (later === undefined || sooner(d, later) < 0) later = d;
  }
  return later;
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

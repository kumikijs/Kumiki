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
 * One place a definition declares a name in a nested scope: the name (`at`), and where the stretch
 * of source it is declared for begins (`from`). A read before `from` is ahead of the scope. A read
 * past it is not, even when it does not resolve: one ahead of the `let` in the same body, or in the
 * list of the `for` or the value of the `let … in` that declares the name, read before the name is
 * in scope. A match arm's pattern binds from the `scrutinee`, which runs from the `match` to the
 * first arm, so a read there is not ahead of the arm either.
 */
export type ScopedDeclaration = {
  kind: NestedScopeKind;
  at: Pos;
  from: Pos;
  scrutinee?: { from: Pos; to: Pos };
};

export type NestedScopes = ReadonlyMap<string, readonly ScopedDeclaration[]>;

function comparePos(a: Pos, b: Pos): number {
  return a.line - b.line || a.col - b.col;
}

/**
 * Where `s` begins: at its own position, but for a write through a field or an index, which is
 * placed at the last of them, at the slot it writes.
 */
function statementStart(s: Statement): Pos {
  if (s.kind !== "SlotAssign") return s.pos;
  let lv = s.lvalue;
  while (lv.kind !== "LSlot") lv = lv.base;
  return lv.pos;
}

/**
 * Every name the definition made of `roots` declares in a nested scope, and where. Built from the
 * tree before the check rather than as the check goes, because a scope the checker reaches after a
 * read still declares the read's name. The `let` statements of the definition's own body are not in
 * a nested scope, so a statement list given as a root declares none of its own `let`s.
 */
export function nestedScopes(
  ...roots: (Expr | TileExpr | Statement[] | undefined)[]
): NestedScopes {
  const table = new Map<string, ScopedDeclaration[]>();
  const declare = (name: string, declaration: ScopedDeclaration): void => {
    const known = table.get(name);
    if (known) known.push(declaration);
    else table.set(name, [declaration]);
  };
  const armBinds = (kind: NestedScopeKind, match: Pos, arms: { pattern: Pattern }[]): void => {
    const first = arms[0];
    if (first === undefined) return;
    const scrutinee = { from: match, to: first.pattern.pos };
    for (const { pattern } of arms) {
      for (const b of patternBinds(pattern)) {
        declare(b.name, { kind, at: b.pos, from: pattern.pos, scrutinee });
      }
    }
  };
  const expr = (e: Expr): void => {
    walkExpr(e, (n) => {
      if (n.kind === "LetIn") declare(n.name, { kind: "let-in", at: n.namePos, from: n.pos });
      if (n.kind === "MatchExpr") armBinds("match-expr", n.pos, n.arms);
    });
  };
  const lvalue = (lv: Lvalue): void => {
    if (lv.kind === "LSlot") return;
    lvalue(lv.base);
    if (lv.kind === "LIndex") expr(lv.index);
  };
  const statements = (stmts: Statement[]): void => {
    for (const s of stmts) statement(s);
  };
  const body = (kind: NestedScopeKind, stmts: Statement[]): void => {
    statements(stmts);
    const first = stmts[0];
    if (first === undefined) return;
    const from = statementStart(first);
    for (const s of stmts) if (s.kind === "LetStmt") declare(s.name, { kind, at: s.namePos, from });
  };
  const statement = (s: Statement): void => {
    switch (s.kind) {
      case "SlotAssign":
        lvalue(s.lvalue);
        expr(s.rhs);
        return;
      case "LetStmt":
        expr(s.rhs);
        return;
      case "Emit":
        for (const a of s.args) expr(a);
        return;
      case "PanicStmt":
        expr(s.message);
        return;
      case "StopTimer":
      case "NoopStmt":
        return;
      case "ForStmt":
        expr(s.iter);
        body("for", s.body);
        declare(s.bind, { kind: "for", at: s.bindPos, from: s.pos });
        return;
      case "IfStmt":
        expr(s.cond);
        body("if", s.consequent);
        body("if", s.alternate);
        return;
      case "MatchStmt":
        expr(s.scrutinee);
        for (const a of s.arms) body("match", a.body);
        armBinds("match", s.pos, s.arms);
        return;
      default:
        assertNever(s);
    }
  };
  const tile = (t: TileExpr): void => {
    switch (t.kind) {
      case "TileCall":
        for (const a of t.args) {
          if (isTileExpr(a.value)) tile(a.value);
          else expr(a.value);
        }
        for (const p of t.props) expr(p.value);
        return;
      case "TileFor":
        expr(t.iter);
        tile(t.body);
        declare(t.bind, { kind: "for-expr", at: t.bindPos, from: t.pos });
        return;
      case "TileWhen":
        expr(t.cond);
        tile(t.body);
        return;
      case "TileIf":
        expr(t.cond);
        tile(t.consequent);
        tile(t.alternate);
        return;
      case "TileMatch":
        expr(t.scrutinee);
        for (const a of t.arms) tile(a.body);
        armBinds("match-expr", t.pos, t.arms);
        return;
      default:
        assertNever(t);
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
  const within = (range: { from: Pos; to: Pos } | undefined): boolean =>
    range !== undefined && comparePos(pos, range.from) >= 0 && comparePos(pos, range.to) < 0;
  let later: ScopedDeclaration | undefined;
  for (const d of scopes.get(name) ?? []) {
    if (comparePos(pos, d.from) >= 0 || within(d.scrutinee)) continue;
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

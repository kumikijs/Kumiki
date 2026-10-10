import type { BinOp, Expr, MatchArm, Pattern, Pos } from "../ast.ts";
import { QUALIFIED_CALL_NAMESPACES } from "../builtin-calls.ts";
import { ParseError } from "./token-stream.ts";
import { TypeParser } from "./types.ts";

/** Stays in step with the AST's spelling of the prefix operators. */
type UnaryOp = Extract<Expr, { kind: "UnaryOp" }>["op"];

export class ExpressionParser extends TypeParser {
  parseExpr(): Expr {
    return this.descend(() => this.parseExprNested());
  }

  protected parseExprNested(): Expr {
    if (this.matchKw("emit")) {
      const start = this.next();
      const effectTok = this.eat("ident");
      const effect = effectTok.value;
      this.eat("op", "(");
      const args: Expr[] = [];
      if (!this.matchOp(")")) {
        args.push(this.parseExpr());
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseExpr());
        }
      }
      this.eat("op", ")");
      return { kind: "EmitExpr", effect, args, effectPos: effectTok.pos, pos: start.pos };
    }
    return this.parseLogicOr();
  }

  protected parseLogicOr(): Expr {
    let lhs = this.parseLogicAnd();
    let built = 0;
    while (this.matchOp("||") || (this.matchOp("|") && !this.looksLikeMatchArm())) {
      built += 1;
      this.widen(built);
      const op = "|" as BinOp;
      this.next();
      const rhs = this.parseLogicAnd();
      lhs = { kind: "BinOp", op, lhs, rhs, pos: lhs.pos };
    }
    return lhs;
  }

  /** Heuristic: after `|`, does it look like the start of a match arm? */
  protected looksLikeMatchArm(): boolean {
    const next = this.peek(1);
    // `| _ ->` is a wildcard match arm
    if (next.kind === "ident" && next.value === "_") return true;
    if (next.kind === "ident" && next.value[0] && next.value[0] >= "A" && next.value[0] <= "Z") {
      const after = this.peek(2);
      if (after.kind === "op" && after.value === "->") return true;
      if (after.kind === "op" && after.value === "(") return this.arrowClosesParens(3);
    }
    if (next.kind === "op" && next.value === "(") return this.arrowClosesParens(2);
    return false;
  }

  protected arrowClosesParens(from: number): boolean {
    let depth = 1;
    let i = from;
    while (depth > 0) {
      const tok = this.peek(i);
      if (tok.kind === "eof") return false;
      if (tok.kind === "op" && tok.value === "(") depth++;
      else if (tok.kind === "op" && tok.value === ")") depth--;
      i++;
    }
    const after = this.peek(i);
    return after.kind === "op" && after.value === "->";
  }

  protected parseLogicAnd(): Expr {
    let lhs = this.parseCmp();
    let built = 0;
    while (this.matchOp("&&") || this.matchOp("&")) {
      built += 1;
      this.widen(built);
      this.next();
      const rhs = this.parseCmp();
      lhs = { kind: "BinOp", op: "&", lhs, rhs, pos: lhs.pos };
    }
    return lhs;
  }

  protected parseCmp(): Expr {
    let lhs = this.parseAdd();
    let built = 0;
    while (this.matchAnyOp(["==", "!=", "<", ">", "<=", ">="])) {
      built += 1;
      this.widen(built);
      const op = this.eat("op").value as BinOp;
      const rhs = this.parseAdd();
      lhs = { kind: "BinOp", op, lhs, rhs, pos: lhs.pos };
    }
    return lhs;
  }

  protected parseAdd(): Expr {
    let lhs = this.parseMul();
    let built = 0;
    while (this.matchAnyOp(["+", "-"])) {
      built += 1;
      this.widen(built);
      const op = this.eat("op").value as BinOp;
      const rhs = this.parseMul();
      lhs = { kind: "BinOp", op, lhs, rhs, pos: lhs.pos };
    }
    return lhs;
  }

  protected parseMul(): Expr {
    let lhs = this.parseUnary();
    let built = 0;
    while (this.matchAnyOp(["*", "/", "%"])) {
      built += 1;
      this.widen(built);
      const op = this.eat("op").value as BinOp;
      const rhs = this.parseUnary();
      lhs = { kind: "BinOp", op, lhs, rhs, pos: lhs.pos };
    }
    return lhs;
  }

  protected parseUnary(): Expr {
    const prefixes: { op: UnaryOp; pos: Pos }[] = [];
    while (true) {
      if (this.matchOp("-")) prefixes.push({ op: "-", pos: this.next().pos });
      else if (this.matchOp("!")) prefixes.push({ op: "!", pos: this.next().pos });
      else if (this.matchT("ident", "not")) prefixes.push({ op: "!", pos: this.next().pos });
      else break;
    }
    this.widen(prefixes.length);
    let e = this.parsePostfix();
    for (const prefix of prefixes.reverse()) {
      e = { kind: "UnaryOp", op: prefix.op, rhs: e, pos: prefix.pos };
    }
    return e;
  }

  protected parsePostfix(): Expr {
    let e = this.parsePrimary();
    let built = 0;
    while (true) {
      if (this.matchOp(".")) {
        built += 1;
        this.widen(built);
        const dotTok = this.next();
        const fldTok = this.peek();
        if (e.kind === "Num" && fldTok.pos.line !== dotTok.pos.line) {
          throw new ParseError(
            `A float needs digits after the decimal point — write "${e.raw ?? e.value}.0"`,
            e.pos,
          );
        }
        if (fldTok.kind !== "ident" && fldTok.kind !== "kw") {
          if (e.kind === "Num") {
            throw new ParseError(
              `A float needs digits after the decimal point — write "${e.raw ?? e.value}.0"`,
              e.pos,
            );
          }
          throw new ParseError(`Expected field or method name`, fldTok.pos);
        }
        this.next();
        const fld = fldTok.value;
        if (this.matchOp("(")) {
          this.next();
          const args: Expr[] = [];
          const isCopyKwargs =
            fld === "copy" &&
            this.matchT("ident") &&
            this.matchTAt(1, "op", "=") &&
            !this.matchTAt(2, "op", "=");
          if (isCopyKwargs) {
            const fields: { kind: "RecordField"; name: string; value: Expr; pos: Pos }[] = [];
            const firstPos = this.peek().pos;
            const readKwarg = (): void => {
              const nameTok = this.eat("ident");
              this.eat("op", "=");
              const value = this.parseExpr();
              fields.push({ kind: "RecordField", name: nameTok.value, value, pos: nameTok.pos });
            };
            readKwarg();
            while (this.matchOp(",")) {
              this.next();
              readKwarg();
            }
            args.push({ kind: "RecordLit", fields, pos: firstPos } as Expr);
          } else if (!this.matchOp(")")) {
            args.push(this.parseExpr());
            while (this.matchOp(",")) {
              this.next();
              args.push(this.parseExpr());
            }
          }
          this.eat("op", ")");
          e = { kind: "MethodCall", receiver: e, method: fld, args, pos: e.pos };
        } else {
          e = { kind: "FieldAccess", base: e, field: fld, pos: e.pos };
        }
      } else if (this.matchOp("[")) {
        built += 1;
        this.widen(built);
        this.next();
        const idx = this.parseExpr();
        this.eat("op", "]");
        e = { kind: "Index", base: e, index: idx, pos: e.pos };
      } else {
        break;
      }
    }
    return e;
  }

  protected parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === "num") {
      this.next();
      return { kind: "Num", value: t.value, raw: t.raw, pos: t.pos };
    }
    if (t.kind === "str") {
      this.next();
      return { kind: "Str", value: t.value, pos: t.pos };
    }
    if (t.kind === "kw" && (t.value === "true" || t.value === "false")) {
      this.next();
      return { kind: "Bool", value: t.value === "true", pos: t.pos };
    }
    if (t.kind === "kw" && t.value === "now") {
      this.next();
      return { kind: "Call", callee: "now", args: [], pos: t.pos };
    }
    if (t.kind === "kw" && t.value === "if") {
      return this.parseIfExpr();
    }
    if (t.kind === "kw" && t.value === "let") {
      return this.parseLetIn();
    }
    if (t.kind === "kw" && t.value === "match") {
      return this.parseMatchExpr();
    }
    if (t.kind === "op" && t.value === "(") {
      this.next();
      if (this.matchOp(")")) {
        this.next();
        return { kind: "Unit", pos: t.pos };
      }
      const inner = this.parseExpr();
      if (this.matchOp(",")) {
        this.next();
        const items: [Expr, Expr, ...Expr[]] = [inner, this.parseExpr()];
        while (this.matchOp(",")) {
          this.next();
          items.push(this.parseExpr());
        }
        this.eat("op", ")");
        return { kind: "TupleLit", items, pos: t.pos };
      }
      this.eat("op", ")");
      return inner;
    }
    if (t.kind === "op" && t.value === "{") {
      return this.parseRecordOrMapLit();
    }
    if (t.kind === "op" && t.value === "[") {
      return this.parseListLit();
    }
    if (t.kind === "op" && t.value === "@") {
      this.next();
      const head = this.peek();
      if (head.kind !== "ident") {
        throw new ParseError(
          "Expected a theme group name after `@` (e.g. `@colors.surface`)",
          head.pos,
        );
      }
      this.next();
      const group = head.value;
      const path: string[] = [];
      while (this.matchOp(".")) {
        this.next();
        const seg = this.peek();
        if (seg.kind !== "ident") {
          throw new ParseError("Expected an identifier in a `@` token reference path", seg.pos);
        }
        this.next();
        path.push(seg.value);
      }
      if (path.length === 0) {
        throw new ParseError(
          `Token reference \`@${group}\` is missing a name (use \`@${group}.<name>\`)`,
          t.pos,
        );
      }
      return { kind: "TokenRef", group, path, pos: t.pos };
    }
    if (t.kind === "op" && t.value === "<") {
      this.next();
      const head = this.eat("ident");
      if (head.value === "any-id") {
        this.eat("op", ">");
        return { kind: "Wildcard", wild: "any-id", pos: t.pos };
      }
      if (head.value === "slots") {
        this.eat("op", ".");
        const slot = this.eat("ident");
        this.eat("op", ">");
        return { kind: "Wildcard", wild: "slot", slot: slot.value, slotPos: slot.pos, pos: t.pos };
      }
      throw new ParseError(
        `Unknown test wildcard "<${head.value}…>" (expected <any-id> or <slots.NAME>)`,
        head.pos,
      );
    }
    if (t.kind === "ident") {
      this.next();
      const name = t.value;
      const isQualifierReceiver = !!name[0] && name[0]! >= "A" && name[0]! <= "Z";
      if (
        QUALIFIED_CALL_NAMESPACES.has(name) &&
        this.matchOp(".") &&
        (this.matchTAt(1, "ident") || this.matchTAt(1, "kw")) &&
        !this.matchTAt(2, "op", "(")
      ) {
        this.next();
        const member = (this.next() as { value: string }).value;
        return { kind: "Call", callee: `${name}.${member}`, args: [], pos: t.pos };
      }
      if (
        isQualifierReceiver &&
        this.matchOp(".") &&
        (this.matchTAt(1, "ident") || this.matchTAt(1, "kw")) &&
        this.matchTAt(2, "op", "(")
      ) {
        this.next();
        const subTok = this.next();
        const sub = "value" in subTok ? String(subTok.value) : "";
        this.eat("op", "(");
        const args: Expr[] = [];
        if (!this.matchOp(")")) {
          args.push(this.parseExpr());
          while (this.matchOp(",")) {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.eat("op", ")");
        return { kind: "Call", callee: `${name}.${sub}`, args, pos: t.pos };
      }
      if (this.matchOp("(")) {
        this.next();
        const args: Expr[] = [];
        if (!this.matchOp(")")) {
          args.push(this.parseExpr());
          while (this.matchOp(",")) {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.eat("op", ")");
        if (name[0] && name[0] >= "A" && name[0] <= "Z") {
          return { kind: "Variant", name, payload: args, pos: t.pos };
        }
        return { kind: "Call", callee: name, args, pos: t.pos };
      }
      if (name[0] && name[0] >= "A" && name[0] <= "Z") {
        return { kind: "Variant", name, payload: [], pos: t.pos };
      }
      return { kind: "Ref", name, pos: t.pos };
    }
    if (t.kind === "op" && (t.value === "$1" || t.value === "$2")) {
      // never lexed as op since `$` is not in our op set; handled separately
    }
    throw new ParseError(`Unexpected token in expression`, t.pos);
  }

  protected parseIfExpr(): Expr {
    const start = this.eat("kw", "if");
    const cond = this.parseExpr();
    this.eat("kw", "then");
    const thenE = this.parseExpr();
    this.eat("kw", "else");
    const elseE = this.parseExpr();
    return { kind: "IfExpr", cond, consequent: thenE, alternate: elseE, pos: start.pos };
  }

  protected parseLetIn(): Expr {
    const start = this.eat("kw", "let");
    const name = this.eat("ident").value;
    this.eat("op", "=");
    const value = this.parseExpr();
    this.eat("kw", "in");
    const body = this.parseExpr();
    return { kind: "LetIn", name, value, body, pos: start.pos };
  }

  protected parseMatchExpr(): Expr {
    const start = this.eat("kw", "match");
    const scrutinee = this.parseExpr();
    this.eat("kw", "with");
    const arms: MatchArm[] = [];
    while (this.matchOp("|")) {
      this.next();
      const pattern = this.parsePattern();
      this.eat("op", "->");
      const body = this.parseExpr();
      arms.push({ pattern, body });
    }
    if (arms.length === 0) throw new ParseError("match requires at least one arm", start.pos);
    return { kind: "MatchExpr", scrutinee, arms, pos: start.pos };
  }

  protected parsePattern(): Pattern {
    return this.descend(() => this.parsePatternNested());
  }

  protected parsePatternNested(): Pattern {
    const t = this.peek();
    if (t.kind === "ident" && t.value === "_") {
      this.next();
      return { kind: "PWildcard", pos: t.pos };
    }
    if (t.kind === "ident") {
      const name = t.value;
      this.next();
      if (this.matchOp("(")) {
        this.next();
        const binds: string[] = [];
        if (!this.matchOp(")")) {
          binds.push(this.parsePatternBind());
          while (this.matchOp(",")) {
            this.next();
            binds.push(this.parsePatternBind());
          }
        }
        this.eat("op", ")");
        return { kind: "PVariant", name, binds, pos: t.pos };
      }
      // bare ident: capital → variant w/o payload, lowercase → bind
      if (name[0] && name[0] >= "A" && name[0] <= "Z") {
        return { kind: "PVariant", name, binds: [], pos: t.pos };
      }
      return { kind: "PBind", name, pos: t.pos };
    }
    if (this.matchOp("(")) {
      this.next();
      const items: Pattern[] = [this.parsePattern()];
      while (this.matchOp(",")) {
        this.next();
        items.push(this.parsePattern());
      }
      this.eat("op", ")");
      if (items.length < 2) {
        throw new ParseError("Tuple pattern requires at least 2 items", t.pos);
      }
      return { kind: "PTuple", items, pos: t.pos };
    }
    throw new ParseError("Expected pattern", t.pos);
  }

  protected parsePatternBind(): string {
    const t = this.peek();
    if (t.kind === "ident") {
      this.next();
      return t.value;
    }
    throw new ParseError("Expected pattern bind", t.pos);
  }

  protected parseRecordOrMapLit(): Expr {
    const start = this.eat("op", "{");
    if (this.matchOp("}")) {
      this.next();
      return { kind: "MapLit", entries: [], pos: start.pos };
    }
    let isRecord = false;
    const k0 = this.peek();
    if (k0.kind === "ident" || k0.kind === "kw") {
      const peek1 = this.peek(1);
      if (
        peek1.kind === "op" &&
        (peek1.value === "=" || peek1.value === ":" || peek1.value === "," || peek1.value === "}")
      ) {
        isRecord = true;
      }
    }
    if (isRecord) {
      const fields: { name: string; value: Expr; pos: Pos }[] = [];
      while (true) {
        const keyTok = this.peek();
        if (keyTok.kind !== "ident" && keyTok.kind !== "kw") {
          throw new ParseError("Expected a record field name", keyTok.pos);
        }
        const fieldName = keyTok.value;
        const fieldPos = keyTok.pos;
        this.next();
        let value: Expr;
        if (this.matchOp("=") || this.matchOp(":")) {
          this.next();
          value = this.parseExpr();
        } else {
          value = { kind: "Ref", name: fieldName, pos: fieldPos };
        }
        fields.push({ name: fieldName, value, pos: fieldPos });
        if (!this.matchOp(",")) break;
        this.next();
      }
      this.eat("op", "}");
      return { kind: "RecordLit", fields, pos: start.pos };
    }
    const entries: { key: Expr; value: Expr }[] = [];
    entries.push(this.parseMapEntry());
    while (this.matchOp(",")) {
      this.next();
      entries.push(this.parseMapEntry());
    }
    this.eat("op", "}");
    return { kind: "MapLit", entries, pos: start.pos };
  }

  protected parseMapEntry(): { key: Expr; value: Expr } {
    const key = this.parseExpr();
    this.eat("op", ":");
    const value = this.parseExpr();
    return { key, value };
  }

  protected parseListLit(): Expr {
    const start = this.eat("op", "[");
    const items: Expr[] = [];
    if (!this.matchOp("]")) {
      items.push(this.parseExpr());
      while (this.matchOp(",")) {
        this.next();
        items.push(this.parseExpr());
      }
    }
    this.eat("op", "]");
    return { kind: "ListLit", items, pos: start.pos };
  }
}

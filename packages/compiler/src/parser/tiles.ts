import type { Expr, TileArg, TileExpr, TileProp } from "../ast.ts";
import { BUILTIN_TILES, parsesPositionalAsTile } from "../builtins.ts";
import { HANDLER_NAMES } from "../ui-lifts.ts";
import { StatementParser } from "./statements.ts";
import { ParseError } from "./token-stream.ts";

function isCapitalised(name: string): boolean {
  const first = name[0];
  return first !== undefined && first >= "A" && first <= "Z";
}

export class TileParser extends StatementParser {
  protected parseTileExpr(): TileExpr {
    return this.descend(() => this.parseTileExprNested(), true);
  }

  protected parseTileExprNested(): TileExpr {
    if (this.matchKw("for")) {
      const start = this.next();
      const bindTok = this.eat("ident");
      this.eat("kw", "in");
      const iter = this.parseExpr();
      const body = this.parseTileExpr();
      return {
        kind: "TileFor",
        bind: bindTok.value,
        bindPos: bindTok.pos,
        iter,
        body,
        pos: start.pos,
      };
    }
    if (this.matchKw("when")) {
      const start = this.next();
      this.eat("op", "(");
      const cond = this.parseExpr();
      this.eat("op", ",");
      const body = this.parseTileExpr();
      this.eat("op", ")");
      return { kind: "TileWhen", cond, body, pos: start.pos };
    }
    if (this.matchKw("if")) {
      const start = this.next();
      const cond = this.parseExpr();
      this.eat("kw", "then");
      const thenT = this.parseTileExpr();
      this.eat("kw", "else");
      const elseT = this.parseTileExpr();
      return { kind: "TileIf", cond, consequent: thenT, alternate: elseT, pos: start.pos };
    }
    if (this.matchKw("match")) {
      return this.parseMatch("TileMatch", () => this.parseTileExpr());
    }
    return this.parseTileCall();
  }

  protected parseTileCall(): TileExpr {
    return this.descend(() => this.parseTileCallNested(), true);
  }

  protected parseTileCallNested(): TileExpr {
    const nameTok = this.eat("ident");
    const name = nameTok.value;
    const args: TileArg[] = [];
    if (this.matchOp("(")) {
      this.next();
      if (!this.matchOp(")")) {
        args.push(this.parseTileArg(name));
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseTileArg(name));
        }
      }
      this.eat("op", ")");
    }
    const props: TileProp[] = [];
    if (this.matchOp("{")) {
      this.next();
      if (!this.matchOp("}")) {
        props.push(this.parseTileProp());
        while (this.matchOp(",")) {
          this.next();
          props.push(this.parseTileProp());
        }
      }
      this.eat("op", "}");
    }
    return { kind: "TileCall", name, args, props, pos: nameTok.pos };
  }

  // A handler may be written as `Bump {}`, which is no expression, so it is parsed apart from the
  // other named arguments.
  protected parseTileArg(callee: string): TileArg {
    const first = this.peek();
    if ((first.kind === "ident" || first.kind === "kw") && this.matchTAt(1, "op", "=")) {
      this.next();
      this.eat("op", "=");
      const value = HANDLER_NAMES.has(first.value)
        ? this.parseHandlerArg(callee)
        : this.parseArgValue(false);
      return { kind: "TileArg", name: first.value, namePos: first.pos, value };
    }
    return { kind: "TileArg", value: this.parseArgValue(parsesPositionalAsTile(callee)) };
  }

  // `Bump`, `Bump()` and `Bump {}` are one node on every tile: a tile call where the positional
  // argument parses as a tile, and the variant tag elsewhere. Elsewhere only a handler carrying
  // braces, which is no expression, takes the call form; one carrying arguments or props stays a
  // tile call for the handler check to refuse.
  protected parseHandlerArg(callee: string): Expr | TileExpr {
    const head = this.peek();
    if (head.kind !== "ident" || !isCapitalised(head.value)) return this.parseArgValue(false);
    if (parsesPositionalAsTile(callee)) return this.parseTileCall();
    if (!this.braceFollowsName()) return this.parseArgValue(false);
    const call = this.parseTileCall();
    if (call.kind !== "TileCall" || call.args.length > 0 || call.props.length > 0) return call;
    return { kind: "Variant", name: call.name, payload: [], pos: call.pos };
  }

  // Whether a `{` follows the name at the cursor, directly or after its parenthesised arguments.
  private braceFollowsName(): boolean {
    let at = 1;
    if (this.matchTAt(at, "op", "(")) {
      for (let open = 0; ; at++) {
        const t = this.peek(at);
        if (t.kind === "eof") return false;
        if (t.kind === "op" && t.value === "(") open++;
        if (t.kind === "op" && t.value === ")" && --open === 0) break;
      }
      at++;
    }
    return this.matchTAt(at, "op", "{");
  }

  // `for` and `when` have no expression form, so they are tiles wherever they are written.
  protected parseArgValue(isTile: boolean): Expr | TileExpr {
    if (this.matchKw("for") || this.matchKw("when")) return this.parseTileExpr();
    if (!isTile) return this.parseExpr();
    if (this.matchKw("if") || this.matchKw("match")) return this.parseTileExpr();
    const head = this.peek();
    if (head.kind === "ident") {
      const next = this.peek(1);
      const opensCall = next.kind === "op" && (next.value === "(" || next.value === "{");
      if (BUILTIN_TILES.has(head.value) && opensCall) return this.parseTileCall();
      if (isCapitalised(head.value)) return this.parseTileCall();
    }
    return this.parseExpr();
  }

  protected parseTileProp(): TileProp {
    const nameTok = this.peek();
    if (nameTok.kind !== "ident" && nameTok.kind !== "kw") {
      throw new ParseError("Expected prop name", nameTok.pos);
    }
    this.next();
    this.eat("op", ":");
    const value = this.parseExpr();
    return { kind: "TileProp", name: nameTok.value as string, pos: nameTok.pos, value };
  }
}

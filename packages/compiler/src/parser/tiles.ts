import type { Expr, TileArg, TileExpr, TileProp } from "../ast.ts";
import { BUILTIN_TILES, positionalIsTile, VALUE_ARG_BUILTINS } from "../builtins.ts";
import { HANDLER_NAMES } from "../ui-lifts.ts";
import { StatementParser } from "./statements.ts";
import { ParseError } from "./token-stream.ts";

function isCapitalised(name: string): boolean {
  const first = name[0];
  return first !== undefined && first >= "A" && first <= "Z";
}

export class TileParser extends StatementParser {
  protected parseTileExpr(): TileExpr {
    return this.descend(() => this.parseTileExprNested());
  }

  protected parseTileExprNested(): TileExpr {
    if (this.matchKw("for")) {
      const start = this.next();
      const bindTok = this.eat("ident");
      this.eat("kw", "in");
      const iter = this.parseExpr();
      const body = this.parseTileExpr();
      return { kind: "TileFor", bind: bindTok.value, iter, body, pos: start.pos };
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
      return { kind: "TileMatch", ...this.parseMatch(() => this.parseTileExpr()) };
    }
    return this.parseTileCall();
  }

  protected parseTileCall(): TileExpr {
    return this.descend(() => this.parseTileCallNested());
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

  // Every named argument is a value but a handler, which takes the call form so that
  // `onClick=Bump {}` parses on every tile.
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
    return { kind: "TileArg", value: this.parseArgValue(positionalIsTile(callee)) };
  }

  // A capitalised handler is a tile call on a builtin other than the value builtins, and a
  // variant tag on any other tile, where the call it is written as is that tag when it carries
  // nothing: `Bump`, `Bump()` and `Bump {}` are one node on every tile.
  protected parseHandlerArg(callee: string): Expr | TileExpr {
    const head = this.peek();
    if (head.kind !== "ident" || !isCapitalised(head.value)) return this.parseArgValue(false);
    if (BUILTIN_TILES.has(callee) && !VALUE_ARG_BUILTINS.has(callee)) return this.parseTileCall();
    if (!this.matchTAt(1, "op", "(") && !this.matchTAt(1, "op", "{")) {
      return this.parseArgValue(false);
    }
    const call = this.parseTileCall();
    if (call.kind !== "TileCall" || call.args.length > 0 || call.props.length > 0) return call;
    return { kind: "Variant", name: call.name, payload: [], pos: call.pos };
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

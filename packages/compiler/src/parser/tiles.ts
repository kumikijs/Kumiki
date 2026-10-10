import type { Expr, TileArg, TileExpr, TileProp } from "../ast.ts";
import { BUILTIN_TILES, VALUE_ARG_BUILTINS } from "../builtins.ts";
import { StatementParser } from "./statements.ts";
import { ParseError } from "./token-stream.ts";

const VALUE_NAMED_ARGS = new Set([
  "text",
  "value",
  "placeholder",
  "to",
  "src",
  "id",
  "key",
  "name",
  "label",
  "title",
  "type",
  "color",
  "bg",
  "size",
  "weight",
  "variant",
  "pad",
  "gap",
  "align",
  "justify",
  "wrap",
  "w",
  "h",
  "min-w",
  "min-h",
  "max-w",
  "max-h",
  "radius",
  "shadow",
  "rows",
  "cols",
  "aspect",
]);

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
    const isBuiltin = BUILTIN_TILES.has(name);
    const takesValueArg = VALUE_ARG_BUILTINS.has(name);
    const args: TileArg[] = [];
    if (this.matchOp("(")) {
      this.next();
      if (!this.matchOp(")")) {
        args.push(this.parseTileArg(isBuiltin, takesValueArg));
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseTileArg(isBuiltin, takesValueArg));
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

  protected parseTileArg(parentIsBuiltin: boolean, parentTakesValueArg = false): TileArg {
    const first = this.peek();
    if ((first.kind === "ident" || first.kind === "kw") && this.matchTAt(1, "op", "=")) {
      const name = first.value;
      this.next();
      this.eat("op", "=");
      const argTakesValue = parentTakesValueArg || VALUE_NAMED_ARGS.has(name);
      const value = this.parseArgValue(parentIsBuiltin, argTakesValue);
      return { kind: "TileArg", name, namePos: first.pos, value };
    }
    return { kind: "TileArg", value: this.parseArgValue(parentIsBuiltin, parentTakesValueArg) };
  }

  protected parseArgValue(parentIsBuiltin = true, parentTakesValueArg = false): Expr | TileExpr {
    if (this.matchKw("for") || this.matchKw("when")) {
      return this.parseTileExpr();
    }
    if (this.matchKw("match")) {
      if (parentTakesValueArg) return this.parseExpr();
      return this.parseTileExpr();
    }
    if (this.matchKw("if")) {
      if (parentTakesValueArg) return this.parseExpr();
      return this.parseTileExpr();
    }
    const tok0 = this.peek();
    if (tok0.kind === "ident") {
      if (parentTakesValueArg) return this.parseExpr();
      const name = tok0.value;
      const p1 = this.peek(1);
      const looksLikeTileCall = p1.kind === "op" && (p1.value === "(" || p1.value === "{");
      const isBuiltin = BUILTIN_TILES.has(name);
      const isCapital = !!name[0] && name[0]! >= "A" && name[0]! <= "Z";
      if (isBuiltin && looksLikeTileCall) return this.parseTileCall();
      if (!parentIsBuiltin) return this.parseExpr();
      // Inside a builtin tile, capital-cased identifiers refer to user tiles.
      if (isCapital && looksLikeTileCall) return this.parseTileCall();
      if (isCapital && !looksLikeTileCall) return this.parseTileCall();
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

import type { Pos, Token } from "../ast.ts";

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(`Parse error at ${pos.line}:${pos.col}: ${message}`);
  }
}

// The typechecker holds a tile tree to this bound too, once its user tiles are inlined (E0237).
export const MAX_NESTING_DEPTH = 256;

export class TokenStream {
  protected i = 0;
  protected depth = 0;

  constructor(protected tokens: Token[]) {}

  /** The one place the budget is refused, so every caller reports alike. */
  protected refuseDepth(): never {
    throw new ParseError(
      `Nesting is deeper than ${MAX_NESTING_DEPTH} levels — extract part of this into a definition of its own`,
      this.peek().pos,
    );
  }

  protected descend<T>(parseNested: () => T): T {
    if (this.depth >= MAX_NESTING_DEPTH) this.refuseDepth();
    this.depth += 1;
    try {
      return parseNested();
    } finally {
      this.depth -= 1;
    }
  }

  protected widen(built: number): void {
    if (this.depth + built >= MAX_NESTING_DEPTH) this.refuseDepth();
  }

  protected peek(offset = 0): Token {
    return this.tokens[this.i + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  protected next(): Token {
    return this.tokens[this.i++] ?? this.tokens[this.tokens.length - 1]!;
  }

  protected eat<K extends Token["kind"]>(kind: K, value?: string): Extract<Token, { kind: K }> {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && "value" in t && t.value !== value)) {
      const got = t.kind === "eof" ? "eof" : `${t.kind}(${t.value})`;
      const want = value !== undefined ? `${kind}(${value})` : kind;
      throw new ParseError(`Expected ${want}, got ${got}`, t.pos);
    }
    this.next();
    return t as Extract<Token, { kind: K }>;
  }

  protected matchTAt(offset: number, kind: Token["kind"], value?: string): boolean {
    const t = this.peek(offset);
    if (t.kind !== kind) return false;
    if (value !== undefined && "value" in t && t.value !== value) return false;
    return true;
  }

  protected matchT(kind: Token["kind"], value?: string): boolean {
    return this.matchTAt(0, kind, value);
  }

  protected matchOp(value: string): boolean {
    return this.matchT("op", value);
  }

  protected matchKw(value: string): boolean {
    return this.matchT("kw", value);
  }

  protected matchAnyOp(ops: string[]): boolean {
    const t = this.peek();
    return t.kind === "op" && ops.includes(t.value);
  }

  /** A number literal with the sign the lexer emits as its own operator. */
  protected eatSignedNumber(): number {
    if (this.matchOp("-") && this.matchTAt(1, "num")) {
      this.next();
      return -this.eat("num").value;
    }
    return this.eat("num").value;
  }

  protected parseDuration(): number {
    const numTok = this.peek();
    const n = this.eatSignedNumber();
    const unitTok = this.eat("ident");
    const unit = unitTok.value;
    if (n < 0) {
      throw new ParseError(`Duration must be 0 or more (got ${n})`, numTok.pos);
    }
    if (unit === "ms") return n;
    if (unit === "s") return n * 1000;
    if (unit === "m") return n * 60 * 1000;
    // At the unit, not at whatever follows it: the unit is what has to change.
    throw new ParseError(`Unknown duration unit "${unit}"`, unitTok.pos);
  }

  /** An identifier, or a keyword used where only a name can appear. */
  protected eatName(): { value: string; pos: Pos } {
    const t = this.peek();
    if (t.kind === "kw") {
      this.next();
      return { value: t.value, pos: t.pos };
    }
    return this.eat("ident");
  }
}

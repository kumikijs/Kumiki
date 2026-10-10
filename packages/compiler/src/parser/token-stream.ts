import type { Pos, Token } from "../ast.ts";

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(`Parse error at ${pos.line}:${pos.col}: ${message}`);
  }
}

const MAX_NESTING_DEPTH = 256;

/** A chain the parser is reading with a loop; see `TokenStream.startChain`. */
export interface Chain {
  /** What the enclosing measurement had reached, handed back by `endChain`. */
  enclosing: number;
  /** How many levels under the chain's own its first operand and the steps so far reach. */
  below: number;
}

export class TokenStream {
  protected i = 0;
  protected depth = 0;
  /** The deepest level a node of the part being measured sits at. */
  protected reached = 0;

  constructor(protected tokens: Token[]) {}

  /** The one place the budget is refused, so every caller reports alike. */
  protected refuseDepth(at: Pos): never {
    throw new ParseError(
      `Nesting is deeper than ${MAX_NESTING_DEPTH} levels — extract part of this into a definition of its own`,
      at,
    );
  }

  protected descend<T>(parseNested: () => T): T {
    if (this.depth >= MAX_NESTING_DEPTH) this.refuseDepth(this.peek().pos);
    this.depth += 1;
    if (this.depth > this.reached) this.reached = this.depth;
    try {
      return parseNested();
    } finally {
      this.depth -= 1;
    }
  }

  /** Returns what the enclosing measurement had reached, for `measured` to fold back in. */
  protected measure(): number {
    const enclosing = this.reached;
    this.reached = this.depth;
    return enclosing;
  }

  /** Levels under the current one the part read since `measure` reaches. */
  protected measured(enclosing: number): number {
    const below = this.reached - this.depth;
    if (enclosing > this.reached) this.reached = enclosing;
    return below;
  }

  /** Puts a node `below` levels under the current one without recursing. */
  protected charge(below: number, at: Pos): void {
    if (this.depth + below >= MAX_NESTING_DEPTH) this.refuseDepth(at);
    if (this.depth + below > this.reached) this.reached = this.depth + below;
  }

  // A loop costs the parser no stack, but each step's node sits over every operand read
  // before it, and everything downstream walks those nodes by recursion.
  protected startChain(): Chain {
    return { enclosing: this.measure(), below: 0 };
  }

  protected chainStep(chain: Chain): void {
    chain.below = Math.max(chain.below, this.measured(chain.enclosing)) + 1;
    this.charge(chain.below, this.peek().pos);
    chain.enclosing = this.measure();
  }

  protected endChain(chain: Chain): void {
    this.measured(chain.enclosing);
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
    return this.eatSignedNumberLit().value;
  }

  /** A number literal with an optional leading `-`, and the text it is written as. */
  protected eatSignedNumberLit(): { value: number; raw: string } {
    if (this.matchOp("-") && this.matchTAt(1, "num")) {
      this.next();
      const t = this.eat("num");
      return { value: -t.value, raw: `-${t.raw}` };
    }
    const t = this.eat("num");
    return { value: t.value, raw: t.raw };
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

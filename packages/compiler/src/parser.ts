import type {
  AppAnalyticsConfig,
  AppDef,
  AppHttpConfig,
  AppIndexedDbConfig,
  AppIndexedDbStore,
  AppMetaConfig,
  BinOp,
  Def,
  DuplicateName,
  EffectDef,
  EventPattern,
  Expr,
  FnDef,
  Lvalue,
  MatchArm,
  MotionDef,
  NamedRef,
  Pattern,
  PolicyExpr,
  Pos,
  Program,
  ReducerDef,
  Refinement,
  RetryExpr,
  SlotDef,
  Statement,
  TestDef,
  ThemeDef,
  TileArg,
  TileDef,
  TileExpr,
  TileMatchArm,
  TileProp,
  Token,
  TypeDef,
  TypeExpr,
  UiEventKind,
} from "./ast.ts";
import { CONSTANT_NAMESPACES } from "./builtin-calls.ts";
import { BUILTIN_TILES, VALUE_ARG_BUILTINS } from "./builtins.ts";

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: Pos,
  ) {
    super(`Parse error at ${pos.line}:${pos.col}: ${message}`);
  }
}

/** Stays in step with the AST's spelling of the prefix operators. */
type UnaryOp = Extract<Expr, { kind: "UnaryOp" }>["op"];

/**
 * How deep a tree a program may build (language.md §1.2.3).
 *
 * The bound is on the *result*, not on how the parser reached it. Everything
 * downstream of the parse — the typechecker, the reference walk, code
 * generation — descends the tree by recursion, so a tree past what the call
 * stack holds surfaces as a bare `RangeError` with no position wherever it is
 * first walked. Bounding the parse alone would only move that crash: a
 * left-associative chain (`1 + 1 + 1 + …`, `x.trim().trim()…`) is parsed by a
 * loop but still builds one node per operator, and at 3,000 operators it
 * parsed clean and then took down `compile`.
 *
 * So a chain counts against the same budget nesting does, and one budget
 * covers both. The limit is far above anything written in practice — no
 * program in this repository's examples or benchmarks comes close, and the
 * corpus gates would fail if one ever did.
 */
const MAX_NESTING_DEPTH = 256;

const PRIM_TYPES = new Set([
  "Int",
  "Text",
  "Bool",
  "Unit",
  "Float",
  "Time",
  "Bytes",
  "File",
  "EffectId",
]);
// Closed set of `app.*` lifecycle events (docs/spec/language.md §1.6.1,
// lifecycle.md §7.1). `app.http-*` keep their hyphenated form — the lexer
// already treats `-` as ident-continuation, so they arrive as a single token.
const APP_LIFECYCLE_EVENTS = new Set([
  "start",
  "stop",
  "error",
  "visible",
  "hidden",
  "online",
  "offline",
  "http-401",
  "http-403",
  "http-5xx",
]);
const _GENERIC_TYPES = new Set(["Map", "Set", "List", "Option", "Result", "Tuple"]);
// Builtins whose positional argument is a value expression (Text/Number), not a tile.
// Named args whose value is always a value expression (Text / Number / etc.),
// independent of the enclosing builtin. This lets `button(text=if c then "A" else "B")`
// parse the `if` as a value-level `IfExpr` instead of a `TileIf`.
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
const REFINE_PREDS = new Set([
  "between",
  "nonempty",
  "len-eq",
  "len-lt",
  "len-gt",
  "positive",
  "negative",
  "email",
  "url",
  "uuid",
  "regex",
  "one-of",
]);

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private tokens: Token[]) {}

  /** The one place the budget is refused, so every caller reports alike. */
  private refuseDepth(): never {
    throw new ParseError(
      `Nesting is deeper than ${MAX_NESTING_DEPTH} levels — extract part of this into a definition of its own`,
      this.peek().pos,
    );
  }

  /**
   * Parse one level deeper, refusing to go past `MAX_NESTING_DEPTH`.
   *
   * Every construct that can contain itself goes through this, so a program
   * that nests too far is reported at the token where the parser stopped
   * rather than crashing the process. The budget is over the whole enclosing
   * tree, not per construct: a pattern inside a slot's initializer starts one
   * level down because that is where its node will sit.
   */
  private descend<T>(parseNested: () => T): T {
    if (this.depth >= MAX_NESTING_DEPTH) this.refuseDepth();
    this.depth += 1;
    try {
      return parseNested();
    } finally {
      this.depth -= 1;
    }
  }

  /**
   * Charge `built` levels against the same budget without recursing.
   *
   * A left-associative chain — `1 + 1 + 1 + …`, `x.trim().trim()…`, a run of
   * prefix operators — is parsed by a loop, so it costs the parser no stack.
   * It still builds one node per operator, each nested inside the last, and
   * everything downstream walks that by recursion. Left unbounded it parsed
   * clean and crashed `compile` instead.
   */
  private widen(built: number): void {
    if (this.depth + built >= MAX_NESTING_DEPTH) this.refuseDepth();
  }

  // ----- low-level token utilities -----

  private peek(offset = 0): Token {
    return this.tokens[this.i + offset] ?? this.tokens[this.tokens.length - 1]!;
  }
  private next(): Token {
    return this.tokens[this.i++] ?? this.tokens[this.tokens.length - 1]!;
  }
  private eat<K extends Token["kind"]>(kind: K, value?: string): Extract<Token, { kind: K }> {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && "value" in t && t.value !== value)) {
      const got = t.kind === "eof" ? "eof" : `${t.kind}(${t.value})`;
      const want = value !== undefined ? `${kind}(${value})` : kind;
      throw new ParseError(`Expected ${want}, got ${got}`, t.pos);
    }
    this.next();
    return t as Extract<Token, { kind: K }>;
  }
  private matchTAt(offset: number, kind: Token["kind"], value?: string): boolean {
    const t = this.peek(offset);
    if (t.kind !== kind) return false;
    if (value !== undefined && "value" in t && t.value !== value) return false;
    return true;
  }
  private matchT(kind: Token["kind"], value?: string): boolean {
    return this.matchTAt(0, kind, value);
  }
  private matchOp(value: string): boolean {
    return this.matchT("op", value);
  }
  private matchKw(value: string): boolean {
    return this.matchT("kw", value);
  }

  // ----- entry -----

  parseProgram(): Program {
    const defs: Def[] = [];
    while (!this.matchT("eof")) {
      if (this.matchT("ident", "theme")) {
        defs.push(this.parseThemeDef());
        continue;
      }
      if (this.matchT("ident", "motion")) {
        defs.push(this.parseMotionDef());
        continue;
      }
      defs.push(this.parseDef());
    }
    return { kind: "Program", defs };
  }

  private parseThemeDef(): Def {
    const start = this.eat("ident", "theme");
    const name = this.eat("ident").value;
    this.eat("op", "=");
    const duplicateKeys: DuplicateName[] = [];
    const body = this.parseThemeRecord(duplicateKeys);
    const def: ThemeDef = { kind: "ThemeDef", name, body, pos: start.pos };
    if (duplicateKeys.length > 0) def.duplicateKeys = duplicateKeys;
    return def;
  }

  // `motion N = { keyframes: {...}, duration: ..., ... }`. The body reuses the
  // theme-record grammar (literals + nested records only), which is exactly why
  // a motion can't reference slots/effects — purity is structural (M5 AC4).
  private parseMotionDef(): Def {
    const start = this.eat("ident", "motion");
    const name = this.eat("ident").value;
    this.eat("op", "=");
    const duplicateKeys: DuplicateName[] = [];
    const body = this.parseThemeRecord(duplicateKeys);
    const def: MotionDef = { kind: "MotionDef", name, body, pos: start.pos };
    if (duplicateKeys.length > 0) def.duplicateKeys = duplicateKeys;
    return def;
  }

  private parseThemeRecord(duplicates: DuplicateName[]): {
    [k: string]: import("./ast.ts").ThemeValue;
  } {
    return this.descend(() => this.parseThemeRecordNested(duplicates));
  }

  private parseThemeRecordNested(duplicates: DuplicateName[]): {
    [k: string]: import("./ast.ts").ThemeValue;
  } {
    this.eat("op", "{");
    // Prototype-less: `out["__proto__"] = v` on an object literal replaces the
    // prototype instead of adding a property, so the key vanished from the
    // body and `Object.hasOwn` could never see it written twice.
    const out: { [k: string]: import("./ast.ts").ThemeValue } = Object.create(null);
    if (!this.matchOp("}")) {
      this.parseThemeEntry(out, duplicates);
      while (this.matchOp(",")) {
        this.next();
        if (this.matchOp("}")) break;
        this.parseThemeEntry(out, duplicates);
      }
    }
    this.eat("op", "}");
    return out;
  }

  private parseThemeEntry(
    out: { [k: string]: import("./ast.ts").ThemeValue },
    duplicates: DuplicateName[],
  ): void {
    const keyTok = this.peek();
    if (keyTok.kind !== "ident" && keyTok.kind !== "kw" && keyTok.kind !== "str") {
      throw new ParseError(`Expected theme key`, keyTok.pos);
    }
    this.next();
    const key = keyTok.value as string;
    // `out` is this record's own keys, so sibling records with a key in common
    // are not a duplicate — only a key written twice in the same braces is.
    if (Object.hasOwn(out, key)) duplicates.push({ name: key, pos: keyTok.pos });
    this.eat("op", ":");
    const v = this.peek();
    if (v.kind === "op" && v.value === "{") {
      out[key] = this.parseThemeRecord(duplicates);
    } else if (v.kind === "str") {
      this.next();
      out[key] = v.value;
    } else if (v.kind === "num") {
      this.next();
      out[key] = v.value;
    } else {
      throw new ParseError(`Theme values must be string, number, or nested record`, v.pos);
    }
  }

  private parseDef(): Def {
    const t = this.peek();
    if (t.kind !== "kw") throw new ParseError("Expected a definition keyword", t.pos);
    switch (t.value) {
      case "type":
        return this.parseType();
      case "slot":
        return this.parseSlot();
      case "reducer":
        return this.parseReducer();
      case "tile":
        return this.parseTile();
      case "fn":
        return this.parseFn();
      case "effect":
        return this.parseEffect();
      case "app":
        return this.parseApp();
      case "test":
        return this.parseTest();
      default:
        throw new ParseError(`Unsupported definition keyword "${t.value}"`, t.pos);
    }
  }

  // ----- type defs -----

  private parseType(): TypeDef {
    const start = this.eat("kw", "type");
    const name = this.eat("ident").value;
    const params: string[] = [];
    if (this.matchOp("(")) {
      this.next();
      if (!this.matchOp(")")) {
        params.push(this.eat("ident").value);
        while (this.matchOp(",")) {
          this.next();
          params.push(this.eat("ident").value);
        }
      }
      this.eat("op", ")");
    }
    this.eat("op", "=");
    const body = this.parseTypeExpr();
    return { kind: "TypeDef", name, params, body, pos: start.pos };
  }

  private parseTypeExpr(): TypeExpr {
    return this.descend(() => this.parseTypeExprNested());
  }

  private parseTypeExprNested(): TypeExpr {
    // Union: parse first, then check for `|` follow-up
    const first = this.parseTypeUnionAtom();
    if (this.matchOp("|")) {
      const variants: { name: string; payloads: TypeExpr[]; pos: Pos }[] = [
        this.typeAsVariant(first),
      ];
      while (this.matchOp("|")) {
        this.next();
        variants.push(this.typeAsVariant(this.parseTypeUnionAtom()));
      }
      return { kind: "TypeUnion", variants, pos: first.pos };
    }
    // Refinement
    if (this.matchKw("where")) {
      this.next();
      const ref = this.parseRefinement();
      return { kind: "TypeRefinement", inner: first, refinement: ref, pos: first.pos };
    }
    return first;
  }

  private typeAsVariant(t: TypeExpr): { name: string; payloads: TypeExpr[]; pos: Pos } {
    if (t.kind === "TypeRef") return { name: t.name, payloads: [], pos: t.pos };
    if (t.kind === "TypeApp") return { name: t.name, payloads: t.args, pos: t.pos };
    throw new ParseError(`Unsupported variant form`, t.pos);
  }

  private parseTypeUnionAtom(): TypeExpr {
    // Handle: nominal, record, primitive, ref, generic
    if (this.matchKw("nominal")) {
      const start = this.next();
      const inner = this.parseTypeAtom();
      let refinement: Refinement | undefined;
      if (this.matchKw("where")) {
        this.next();
        refinement = this.parseRefinement();
      }
      const node: TypeExpr = { kind: "TypeNominal", inner, pos: start.pos };
      if (refinement) (node as { refinement?: Refinement }).refinement = refinement;
      return node;
    }
    const atom = this.parseTypeAtom();
    if (this.matchKw("where")) {
      this.next();
      const ref = this.parseRefinement();
      return { kind: "TypeRefinement", inner: atom, refinement: ref, pos: atom.pos };
    }
    return atom;
  }

  private parseTypeAtom(): TypeExpr {
    // Record: { fields }
    if (this.matchOp("{")) {
      const start = this.next();
      const fields: { name: string; type: TypeExpr; pos: Pos }[] = [];
      if (!this.matchOp("}")) {
        fields.push(this.parseTypeField());
        while (this.matchOp(",")) {
          this.next();
          fields.push(this.parseTypeField());
        }
      }
      this.eat("op", "}");
      return { kind: "TypeRecord", fields, pos: start.pos };
    }
    // identifier or generic
    const t = this.eat("ident");
    const name = t.value;
    if (this.matchOp("(")) {
      // generic application
      this.next();
      const args: TypeExpr[] = [];
      if (!this.matchOp(")")) {
        args.push(this.parseTypeExpr());
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseTypeExpr());
        }
      }
      this.eat("op", ")");
      return { kind: "TypeApp", name, args, pos: t.pos };
    }
    if (PRIM_TYPES.has(name)) {
      return { kind: "TypePrim", name: name as "Int", pos: t.pos };
    }
    return { kind: "TypeRef", name, pos: t.pos };
  }

  private parseTypeField(): { name: string; type: TypeExpr; pos: Pos } {
    const tok = this.eat("ident");
    this.eat("op", ":");
    const type = this.parseTypeExpr();
    return { name: tok.value, type, pos: tok.pos };
  }

  private parseRefinement(): Refinement {
    const t = this.eat("ident");
    const name = t.value;
    if (!REFINE_PREDS.has(name)) {
      throw new ParseError(`Unknown refinement predicate "${name}"`, t.pos);
    }
    const args: (number | string)[] = [];
    if (this.matchOp("(")) {
      this.next();
      if (!this.matchOp(")")) {
        args.push(this.parseRefinementArg());
        while (this.matchOp(",")) {
          this.next();
          args.push(this.parseRefinementArg());
        }
      }
      this.eat("op", ")");
    }
    return { kind: "Refinement", pred: name, args, pos: t.pos };
  }

  private parseRefinementArg(): number | string {
    const t = this.peek();
    // A refinement's arguments are literals, and `-40.0` is one. The lexer
    // emits the sign as its own operator (it has no way to know whether a `-`
    // is unary), so a literal-only position has to put it back.
    if (t.kind === "op" && t.value === "-" && this.matchTAt(1, "num")) {
      this.next();
      const n = this.next() as { value: number };
      return -n.value;
    }
    if (t.kind === "num") {
      this.next();
      return t.value;
    }
    if (t.kind === "str") {
      this.next();
      return t.value;
    }
    throw new ParseError("Refinement argument must be a literal", t.pos);
  }

  // ----- slot -----

  private parseSlot(): SlotDef {
    const start = this.eat("kw", "slot");
    const name = this.eat("ident").value;
    this.eat("op", ":");
    const type = this.parseTypeExpr();
    let modifier: SlotDef["modifier"];
    if (this.matchT("ident", "transient")) {
      this.next();
      modifier = "transient";
    } else if (this.matchT("ident", "volatile")) {
      this.next();
      modifier = "volatile";
    }
    this.eat("op", "=");
    const init = this.parseExpr();
    const def: SlotDef = { kind: "SlotDef", name, type, init, pos: start.pos };
    if (modifier) def.modifier = modifier;
    return def;
  }

  // ----- reducer -----

  private parseReducer(): ReducerDef {
    const start = this.eat("kw", "reducer");
    const name = this.eat("ident").value;
    this.eat("kw", "on");
    this.eat("op", "=");
    const on = this.parseEventPattern();
    this.eat("kw", "do");
    this.eat("op", "=");
    const stmts: Statement[] = [this.parseStatement()];
    while (this.matchOp(";") || this.statementLookahead()) {
      if (this.matchOp(";")) this.next();
      stmts.push(this.parseStatement());
    }
    return { kind: "ReducerDef", name, on, do: stmts, pos: start.pos };
  }

  // Detect when a new statement starts even without an explicit `;` (newline-friendly):
  // identifier followed by `:=`, `[`, `.`, or keyword `let`/`emit`.
  private statementLookahead(): boolean {
    if (
      this.matchKw("let") ||
      this.matchKw("emit") ||
      this.matchKw("for") ||
      this.matchKw("if") ||
      this.matchKw("match")
    ) {
      return true;
    }
    if (this.peek().kind === "ident") {
      // look further
      const j = this.i + 1;
      while (j < this.tokens.length) {
        const t = this.tokens[j]!;
        if (t.kind === "op" && (t.value === ":=" || t.value === "[" || t.value === "."))
          return true;
        if (t.kind === "op" && (t.value === ":=" || t.value === "(")) return true;
        if (t.kind === "kw") return false;
        if (t.kind === "ident") return false;
        if (t.kind === "eof") return false;
        // operators that continue an expression
        return false;
      }
    }
    return false;
  }

  private parseEventPattern(): EventPattern {
    const t = this.peek();
    // Special case: timer(<duration>) — a periodic lifecycle event
    if (t.kind === "ident" && t.value === "timer") {
      this.next();
      this.eat("op", "(");
      const intervalMs = this.parseDuration();
      let name: string | undefined;
      if (this.matchOp(",")) {
        this.next();
        const kw = this.eat("ident");
        if (kw.value !== "name") throw new ParseError(`Expected "name=" in timer(...)`, kw.pos);
        this.eat("op", "=");
        name = this.eat("ident").value;
      }
      this.eat("op", ")");
      return name === undefined
        ? { kind: "TimerEvent", intervalMs, pos: t.pos }
        : { kind: "TimerEvent", intervalMs, name, pos: t.pos };
    }
    // event patterns start with an identifier-like token: `ui`, `app`, `tile`, `route`, or an effect name
    if (t.kind === "ident" || (t.kind === "kw" && (t.value === "app" || t.value === "tile"))) {
      const name = t.value;
      this.next();
      this.eat("op", ".");
      const sub = this.eat("ident").value;
      if (name === "ui") {
        if (
          sub !== "click" &&
          sub !== "submit" &&
          sub !== "change" &&
          sub !== "input" &&
          sub !== "focus" &&
          sub !== "blur" &&
          sub !== "key" &&
          sub !== "hover"
        ) {
          throw new ParseError(`Unknown ui event "${sub}"`, t.pos);
        }
        this.eat("op", "(");
        const tileTok = this.eat("ident");
        const tile = tileTok.value;
        let id: string | undefined;
        if (this.matchOp("#")) {
          this.next();
          id = this.eat("ident").value;
        }
        this.eat("op", ")");
        const sel: { tile: string; id?: string; tilePos?: Pos } = { tile, tilePos: tileTok.pos };
        if (id) sel.id = id;
        return { kind: "UiEvent", ev: sub as UiEventKind, selector: sel, pos: t.pos };
      }
      if (name === "app") {
        if (!APP_LIFECYCLE_EVENTS.has(sub)) {
          throw new ParseError(`Unknown app lifecycle event "app.${sub}"`, t.pos);
        }
        return { kind: "LifecycleEvent", name: `app.${sub}`, pos: t.pos };
      }
      if (name === "tile") {
        // `tile.mount(TileName)` / `tile.unmount(TileName)` carry the tile name.
        // The name is part of the event identity: the runtime fires the reducer
        // when *that* user-defined tile enters/leaves the rendered tree, so the
        // ident must be preserved here. Encode the same way the runtime sees it.
        if (sub !== "mount" && sub !== "unmount") {
          throw new ParseError(`Unknown tile lifecycle event "tile.${sub}"`, t.pos);
        }
        this.eat("op", "(");
        const tileTok = this.eat("ident");
        this.eat("op", ")");
        return {
          kind: "LifecycleEvent",
          name: `tile.${sub}(${JSON.stringify(tileTok.value)})`,
          tileTarget: { event: `tile.${sub}`, name: tileTok.value, pos: tileTok.pos },
          pos: t.pos,
        };
      }
      if (name === "route") {
        // `route.enter("/p")` / `route.leave("/p")` / `route.error("/p")` carry
        // the route pattern. The pattern is part of the event identity: the
        // runtime dispatches by matching the reducer's name against
        // `route.enter(${JSON.stringify(matchedPattern)})`, so the literal must
        // be preserved here (dropping it would leave every route reducer dead).
        // Encode it the same way the runtime does so the names match verbatim.
        if (sub !== "enter" && sub !== "leave" && sub !== "error") {
          throw new ParseError(`Unknown route lifecycle event "route.${sub}"`, t.pos);
        }
        this.eat("op", "(");
        const pattern = this.eat("str").value;
        this.eat("op", ")");
        return {
          kind: "LifecycleEvent",
          name: `route.${sub}(${JSON.stringify(pattern)})`,
          pos: t.pos,
        };
      }
      // effect-name.ok / .err
      if (sub === "ok" || sub === "err") {
        this.eat("op", "(");
        const binds: string[] = [];
        if (!this.matchOp(")")) {
          binds.push(this.readBind());
          while (this.matchOp(",")) {
            this.next();
            binds.push(this.readBind());
          }
        }
        this.eat("op", ")");
        return {
          kind: "EffectEvent",
          effect: name,
          outcome: sub,
          binds,
          // `t` is the effect name itself — the pattern starts with it.
          effectPos: t.pos,
          pos: t.pos,
        };
      }
      throw new ParseError(`Unsupported event pattern "${name}.${sub}"`, t.pos);
    }
    throw new ParseError("Expected event pattern", t.pos);
  }

  private readBind(): string {
    if (this.matchOp("_")) {
      this.next();
      return "_";
    }
    const t = this.peek();
    if (t.kind === "op" && t.value === "$") {
      // not actually used; binds in event are bare identifiers per spec
    }
    if (this.matchT("ident", "_")) {
      this.next();
      return "_";
    }
    const tok = this.eat("ident");
    return tok.value;
  }

  // ----- statements -----

  private parseStatement(): Statement {
    return this.descend(() => this.parseStatementNested());
  }

  private parseStatementNested(): Statement {
    if (this.matchKw("for")) {
      const start = this.next();
      const bindTok = this.eat("ident");
      this.eat("kw", "in");
      const iter = this.parseExpr();
      const body = this.parseStatementBody();
      return { kind: "ForStmt", bind: bindTok.value, iter, body, pos: start.pos };
    }
    if (this.matchKw("if")) {
      const start = this.next();
      const cond = this.parseExpr();
      this.eat("kw", "then");
      const thenBody = this.parseStatementBody();
      let elseBody: Statement[] = [];
      if (this.matchKw("else")) {
        this.next();
        elseBody = this.parseStatementBody();
      }
      return { kind: "IfStmt", cond, consequent: thenBody, alternate: elseBody, pos: start.pos };
    }
    if (this.matchKw("match")) {
      const start = this.next();
      const scrutinee = this.parseExpr();
      this.eat("kw", "with");
      const arms: { pattern: Pattern; body: Statement[] }[] = [];
      while (this.matchOp("|")) {
        this.next();
        const pattern = this.parsePattern();
        this.eat("op", "->");
        const body = this.parseStatementBody();
        arms.push({ pattern, body });
      }
      return { kind: "MatchStmt", scrutinee, arms, pos: start.pos };
    }
    if (this.matchOp("(") && this.matchTAt(1, "op", ")")) {
      // `()` as a statement → noop
      const tok = this.next();
      this.eat("op", ")");
      return { kind: "NoopStmt", pos: tok.pos };
    }
    if (this.matchKw("let")) {
      const start = this.next();
      const name = this.eat("ident").value;
      this.eat("op", "=");
      const rhs = this.parseExpr();
      return { kind: "LetStmt", name, rhs, pos: start.pos };
    }
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
      return { kind: "Emit", effect, args, effectPos: effectTok.pos, pos: start.pos };
    }
    // `stop-timer(N)` — clear a named timer. `stop-timer` lexes as one ident.
    const cur = this.peek();
    if (cur.kind === "ident" && cur.value === "stop-timer") {
      this.next();
      this.eat("op", "(");
      const name = this.eat("ident").value;
      this.eat("op", ")");
      return { kind: "StopTimer", name, pos: cur.pos };
    }
    // `panic("...")` (stdlib §2.4) is documented as usable inside a reducer,
    // and a reducer body is statements. As an expression it was writable only
    // by assigning it to something, which is the opposite of what it does.
    if (cur.kind === "ident" && cur.value === "panic" && this.matchTAt(1, "op", "(")) {
      this.next();
      this.eat("op", "(");
      const message = this.parseExpr();
      this.eat("op", ")");
      return { kind: "PanicStmt", message, pos: cur.pos };
    }
    // SlotAssign with lvalue path
    const lvalue = this.parseLvalue();
    this.eat("op", ":=");
    const rhs = this.parseExpr();
    return { kind: "SlotAssign", lvalue, rhs, pos: lvalue.pos };
  }

  /**
   * Body of a control-flow statement (for / if-stmt / match-stmt arm).
   * Three accepted forms:
   *   - `{ stmt (; stmt)* }` explicit brace block
   *   - `stmt; stmt; ...` semicolon-separated (until next branch keyword)
   *   - `stmt\n stmt\n ...` newline-separated (until next branch keyword)
   * Stops at `else`, `}`, `|` (match arm), or EOF — those belong to the enclosing form.
   */
  private parseStatementBody(): Statement[] {
    if (this.matchOp("{")) {
      this.next();
      const out: Statement[] = [];
      if (!this.matchOp("}")) {
        out.push(this.parseStatement());
        while (this.matchOp(";") || (this.statementLookahead() && !this.matchOp("}"))) {
          if (this.matchOp(";")) this.next();
          if (this.matchOp("}")) break;
          out.push(this.parseStatement());
        }
      }
      this.eat("op", "}");
      return out;
    }
    const out: Statement[] = [this.parseStatement()];
    while (this.matchOp(";") || this.statementLookahead()) {
      if (this.matchOp(";")) this.next();
      // Stop at branch terminators that belong to the enclosing if / match / block.
      if (this.matchKw("else") || this.matchOp("}") || this.matchOp("|")) break;
      out.push(this.parseStatement());
    }
    return out;
  }

  private parseLvalue(): Lvalue {
    const tok = this.eat("ident");
    let lv: Lvalue = { kind: "LSlot", name: tok.value, pos: tok.pos };
    while (true) {
      if (this.matchOp(".")) {
        this.next();
        const f = this.eat("ident");
        lv = { kind: "LField", base: lv, field: f.value, pos: f.pos };
      } else if (this.matchOp("[")) {
        const t = this.next();
        const idx = this.parseExpr();
        this.eat("op", "]");
        lv = { kind: "LIndex", base: lv, index: idx, pos: t.pos };
      } else {
        break;
      }
    }
    return lv;
  }

  // ----- expressions -----

  parseExpr(): Expr {
    return this.descend(() => this.parseExprNested());
  }

  private parseExprNested(): Expr {
    // `emit X(args)` as an expression (spec http.md §6.4, stdlib §2.1.1.1) —
    // yields the dispatched effect's `EffectId`. Statement-form `emit` is
    // parsed earlier in `parseStatement` (with no capture), so we only reach
    // this branch when `emit` appears in an expression position such as
    // `let id = emit X(...)`.
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

  private parseLogicOr(): Expr {
    let lhs = this.parseLogicAnd();
    // `||` always works as bool OR. `|` also works as bool OR EXCEPT when it
    // clearly starts a match arm — i.e. it's immediately followed by a pattern
    // (capital-letter variant or `_`) and a `->`. This lets `a | b` mean bool
    // OR in expression context while still letting `not x | Done -> ...` be
    // parsed as a match arm separator.
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
  private looksLikeMatchArm(): boolean {
    const next = this.peek(1);
    // `| _ ->` is a wildcard match arm
    if (next.kind === "ident" && next.value === "_") return true;
    // `| Variant ->` / `| Variant(args) ->`, and `| (p, q) ->` — a tuple
    // pattern arm (§1.9). A payload or a tuple proves nothing on its own:
    // `a | Some(1).is-some` and `a | (b)` are ors written with the same tokens,
    // so what decides is whether a `->` closes the parens.
    if (next.kind === "ident" && next.value[0] && next.value[0] >= "A" && next.value[0] <= "Z") {
      const after = this.peek(2);
      if (after.kind === "op" && after.value === "->") return true;
      if (after.kind === "op" && after.value === "(") return this.arrowClosesParens(3);
    }
    if (next.kind === "op" && next.value === "(") return this.arrowClosesParens(2);
    return false;
  }

  /**
   * From `peek(from)`, one paren already open: skip to its match and answer
   * whether a `->` follows it.
   */
  private arrowClosesParens(from: number): boolean {
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
  private parseLogicAnd(): Expr {
    let lhs = this.parseCmp();
    // `&&` and `&` are both accepted as boolean AND — `&` is a tolerance alias
    // for LLMs that bring C-style habits. (`|` would conflict with type union
    // and match arm separator; only `&` can be safely aliased.)
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
  private parseCmp(): Expr {
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
  private parseAdd(): Expr {
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
  private parseMul(): Expr {
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
  private parseUnary(): Expr {
    // A run of prefix operators (`- - x`, `not not b`) is collected in a loop
    // rather than by recursing per operator: a chain is not nesting, and one
    // long enough used to exhaust the stack. `not` is the keyword spelling
    // of `!`.
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

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    let built = 0;
    while (true) {
      if (this.matchOp(".")) {
        built += 1;
        this.widen(built);
        const dotTok = this.next();
        const fldTok = this.peek();
        // `slot s : Float = 1.` at the end of a line: the member name is
        // whatever the next line starts with, so this reads as a chained
        // access and the error surfaces there instead. A chain written across
        // lines puts the `.` on the member's line, never on the receiver's.
        if (e.kind === "Num" && fldTok.pos.line !== dotTok.pos.line) {
          throw new ParseError(
            `A float needs digits after the decimal point — write "${e.raw ?? e.value}.0"`,
            e.pos,
          );
        }
        if (fldTok.kind !== "ident" && fldTok.kind !== "kw") {
          // `1.` lexes as the number then the access operator, so what arrives
          // here is a member access with no member — and `Expected field or
          // method name` describes the tokens rather than the mistake.
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
          // method call
          this.next();
          const args: Expr[] = [];
          // `.copy(field=value, ...)` is a record-update syntax: the named
          // args are collected into a single RecordLit and the method call
          // proceeds with one arg. (See docs/spec/language.md §1.6 lvalue path.)
          const isCopyKwargs =
            fld === "copy" &&
            this.matchT("ident") &&
            this.matchTAt(1, "op", "=") &&
            // Not `==` (comparison) — peek further
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

  private parsePrimary(): Expr {
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
      // `()` is the unit literal (spec §1.2). It was writable only as a bare
      // statement, so §7's `do= ()` read and §8's `-> ()` did not.
      if (this.matchOp(")")) {
        this.next();
        return { kind: "Unit", pos: t.pos };
      }
      const inner = this.parseExpr();
      // `(a, b)` is a tuple. `Tuple` is a type and tuple PATTERNS destructure
      // one, so §1.8.4's `match (lr, tag) with` was a documented example with
      // no way to write its scrutinee.
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
    // Theme-token reference (spec/style.md §4.3): `@<group>.<name>(.<sub>)*`.
    // Requires at least one segment under the group (`@colors` alone is rejected).
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
    // Test `expect` wildcards (spec/testing.md §8.2.2): `<any-id>` / `<slots.X>`.
    // A leading `<` can only begin a wildcard — a real expression never starts
    // with the comparison operator — so this stays unambiguous.
    if (t.kind === "op" && t.value === "<") {
      this.next();
      const head = this.eat("ident");
      if (head.value === "any-id") {
        this.eat("op", ">");
        return { kind: "Wildcard", wild: "any-id", pos: t.pos };
      }
      if (head.value === "slots") {
        this.eat("op", ".");
        const slot = this.eat("ident").value;
        this.eat("op", ">");
        return { kind: "Wildcard", wild: "slot", slot, pos: t.pos };
      }
      throw new ParseError(
        `Unknown test wildcard "<${head.value}…>" (expected <any-id> or <slots.NAME>)`,
        head.pos,
      );
    }
    if (t.kind === "ident") {
      this.next();
      const name = t.value;
      // qualified call (Module.fn / TypeName.method) — only when the receiver is a
      // capital-cased identifier; otherwise this is a method call on a value and
      // should be parsed by parsePostfix.
      const isQualifierReceiver = !!name[0] && name[0]! >= "A" && name[0]! <= "Z";
      // A member of a constant namespace, written without parentheses:
      // `EffectId.none` (stdlib §2.1.1.1), `Decoder.Text` / `Decoder.Bytes` /
      // `Decoder.None` (http §6.1.4). Read as a 0-arg Call so typecheck and
      // codegen handle it through the same builtin-call channel as
      // `Decoder.Json(User)` / `TodoId.fresh()` — one decision site rather than
      // three. Left to postfix parsing it becomes a field read on a variant of
      // the qualifier's name, which emits `undefined` and which nothing objects
      // to; the member being wrong is then an E0116 rather than silence.
      if (
        CONSTANT_NAMESPACES.has(name) &&
        this.matchOp(".") &&
        (this.matchTAt(1, "ident") || this.matchTAt(1, "kw")) &&
        !this.matchTAt(2, "op", "(")
      ) {
        this.next(); // .
        const memberTok = this.next();
        const member = "value" in memberTok ? String(memberTok.value) : "";
        return { kind: "Call", callee: `${name}.${member}`, args: [], pos: t.pos };
      }
      if (
        isQualifierReceiver &&
        this.matchOp(".") &&
        (this.matchTAt(1, "ident") || this.matchTAt(1, "kw")) &&
        this.matchTAt(2, "op", "(")
      ) {
        this.next(); // .
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
      // direct call
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
        // variant constructor heuristic: identifier with capital first letter
        if (name[0] && name[0] >= "A" && name[0] <= "Z") {
          return { kind: "Variant", name, payload: args, pos: t.pos };
        }
        return { kind: "Call", callee: name, args, pos: t.pos };
      }
      // bare identifier — could be ref OR variant (no payload)
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

  private parseIfExpr(): Expr {
    const start = this.eat("kw", "if");
    const cond = this.parseExpr();
    this.eat("kw", "then");
    const thenE = this.parseExpr();
    this.eat("kw", "else");
    const elseE = this.parseExpr();
    return { kind: "IfExpr", cond, consequent: thenE, alternate: elseE, pos: start.pos };
  }

  private parseLetIn(): Expr {
    const start = this.eat("kw", "let");
    const name = this.eat("ident").value;
    this.eat("op", "=");
    const value = this.parseExpr();
    this.eat("kw", "in");
    const body = this.parseExpr();
    return { kind: "LetIn", name, value, body, pos: start.pos };
  }

  private parseMatchExpr(): Expr {
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

  private parsePattern(): Pattern {
    return this.descend(() => this.parsePatternNested());
  }

  private parsePatternNested(): Pattern {
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
      // Tuple pattern: `(p1, p2, ...)` requires ≥ 2 items; a single parenthesized
      // pattern would be plain grouping with no semantics, so reject it.
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

  private parsePatternBind(): string {
    const t = this.peek();
    if (t.kind === "ident") {
      this.next();
      return t.value;
    }
    throw new ParseError("Expected pattern bind", t.pos);
  }

  private parseRecordOrMapLit(): Expr {
    const start = this.eat("op", "{");
    // Empty {} → MapLit (no entries)
    if (this.matchOp("}")) {
      this.next();
      return { kind: "MapLit", entries: [], pos: start.pos };
    }
    // Heuristic: if the first key is a field name (identifier or keyword, e.g.
    // `type` / `in`) followed by `=`, `:`, `,`, or `}`, treat the whole literal
    // as a record. Otherwise it's a map. A bare keyword key is never a valid map
    // key, so this stays unambiguous.
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
    // Map literal
    const entries: { key: Expr; value: Expr }[] = [];
    entries.push(this.parseMapEntry());
    while (this.matchOp(",")) {
      this.next();
      entries.push(this.parseMapEntry());
    }
    this.eat("op", "}");
    return { kind: "MapLit", entries, pos: start.pos };
  }

  private parseMapEntry(): { key: Expr; value: Expr } {
    const key = this.parseExpr();
    this.eat("op", ":");
    const value = this.parseExpr();
    return { key, value };
  }

  private parseListLit(): Expr {
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

  private matchAnyOp(ops: string[]): boolean {
    const t = this.peek();
    return t.kind === "op" && ops.includes(t.value);
  }

  // ----- tile -----

  private parseTile(): TileDef {
    const start = this.eat("kw", "tile");
    const name = this.eat("ident").value;
    let inType: TypeExpr | undefined;
    let errorBoundary: string | undefined;
    let errorBoundaryPos: Pos | undefined;
    let subRoutes: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] | undefined;
    let scrollRestoration: boolean | undefined;
    const duplicateClauses: DuplicateName[] = [];
    const seenClauses = new Set<string>();
    // Same assembly as `app` and `effect`: one variable per clause, so a
    // second `in=` silently retypes `$1` and a second `error-boundary=`
    // decides by line order which tile a failed render falls back to.
    const noteClause = (tok: Token): void => {
      // Only the clause keywords matter; the loop rejects anything else.
      if (tok.kind !== "kw" && tok.kind !== "ident") return;
      if (seenClauses.has(tok.value)) duplicateClauses.push({ name: tok.value, pos: tok.pos });
      seenClauses.add(tok.value);
    };
    while (!this.matchOp("=")) {
      noteClause(this.peek());
      if (this.matchKw("in")) {
        this.next();
        this.eat("op", "=");
        inType = this.parseTypeExpr();
        continue;
      }
      if (this.matchT("ident", "error-boundary")) {
        this.next();
        this.eat("op", "=");
        const tok = this.eat("ident");
        errorBoundary = tok.value;
        errorBoundaryPos = tok.pos;
        continue;
      }
      if (this.matchT("ident", "scroll-restoration")) {
        const head = this.next();
        this.eat("op", "=");
        const t = this.peek();
        if (t.kind === "kw" && (t.value === "true" || t.value === "false")) {
          scrollRestoration = t.value === "true";
          this.next();
        } else {
          throw new ParseError(
            `scroll-restoration expects a boolean literal (true or false)`,
            head.pos,
          );
        }
        continue;
      }
      if (this.matchT("ident", "sub-routes")) {
        this.next();
        this.eat("op", "=");
        subRoutes = this.parseRouteMap();
        continue;
      }
      const t = this.peek();
      throw new ParseError(`Unexpected token in tile definition`, t.pos);
    }
    this.eat("op", "=");
    const body = this.parseTileExpr();
    const def: TileDef = { kind: "TileDef", name, body, pos: start.pos };
    if (duplicateClauses.length > 0) def.duplicateClauses = duplicateClauses;
    if (inType) def.in = inType;
    if (errorBoundary) def.errorBoundary = errorBoundary;
    if (errorBoundaryPos) def.errorBoundaryPos = errorBoundaryPos;
    if (subRoutes) def.subRoutes = subRoutes;
    if (scrollRestoration === false) def.scrollRestoration = false;
    return def;
  }

  private parseTileExpr(): TileExpr {
    return this.descend(() => this.parseTileExprNested());
  }

  private parseTileExprNested(): TileExpr {
    // for/when/if/match control
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
      const start = this.next();
      const scrut = this.parseExpr();
      this.eat("kw", "with");
      const arms: TileMatchArm[] = [];
      while (this.matchOp("|")) {
        this.next();
        const pattern = this.parsePattern();
        this.eat("op", "->");
        const body = this.parseTileExpr();
        arms.push({ pattern, body });
      }
      return { kind: "TileMatch", scrutinee: scrut, arms, pos: start.pos };
    }
    return this.parseTileCall();
  }

  private parseTileCall(): TileExpr {
    return this.descend(() => this.parseTileCallNested());
  }

  private parseTileCallNested(): TileExpr {
    const nameTok = this.eat("ident");
    const name = nameTok.value;
    const isBuiltin = BUILTIN_TILES.has(name);
    // value-arg builtins take a text/number expression as their positional arg,
    // not a tile. `match` inside them is a value match (`MatchExpr`), not a
    // tile match (`TileMatch`).
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

  private parseTileArg(parentIsBuiltin: boolean, parentTakesValueArg = false): TileArg {
    // named arg: (ident|kw) = (expr | tile)
    const first = this.peek();
    if ((first.kind === "ident" || first.kind === "kw") && this.matchTAt(1, "op", "=")) {
      const name = first.value;
      this.next();
      this.eat("op", "=");
      // Named args with a well-known value-typed name (text/value/placeholder
      // /to/src/id/key/...) are always parsed in value context, regardless of
      // whether the parent tile is itself a value-arg builtin.
      const argTakesValue = parentTakesValueArg || VALUE_NAMED_ARGS.has(name);
      const value = this.parseArgValue(parentIsBuiltin, argTakesValue);
      return { kind: "TileArg", name, namePos: first.pos, value };
    }
    return { kind: "TileArg", value: this.parseArgValue(parentIsBuiltin, parentTakesValueArg) };
  }

  private parseArgValue(parentIsBuiltin = true, parentTakesValueArg = false): Expr | TileExpr {
    if (this.matchKw("for") || this.matchKw("when")) {
      return this.parseTileExpr();
    }
    if (this.matchKw("match")) {
      // value-arg builtins (text / heading / markdown / label / link) take an
      // expression positional arg, so a `match` inside them is a value match.
      // Other tile-arg builtins (column / row / card / page / ...) take tiles,
      // so `match` produces a `TileMatch`.
      if (parentTakesValueArg) return this.parseExpr();
      return this.parseTileExpr();
    }
    if (this.matchKw("if")) {
      // Same dispatch as `match`: value-arg builtins take an expression-level if,
      // tile-arg builtins take a tile-level if.
      if (parentTakesValueArg) return this.parseExpr();
      return this.parseTileExpr();
    }
    const tok0 = this.peek();
    if (tok0.kind === "ident") {
      // Value-arg builtins (heading/text/markdown/label/link/image/icon) take a
      // value expression, never a nested tile. An identifier here is always a
      // value — even one that shadows a builtin tile name (e.g. a user
      // `fn label`) or is capital-cased — so parse it as an expression. Without
      // this guard `heading(label(x))` mis-parses `label(x)` as a builtin tile.
      if (parentTakesValueArg) return this.parseExpr();
      const name = tok0.value;
      const p1 = this.peek(1);
      const looksLikeTileCall = p1.kind === "op" && (p1.value === "(" || p1.value === "{");
      const isBuiltin = BUILTIN_TILES.has(name);
      const isCapital = !!name[0] && name[0]! >= "A" && name[0]! <= "Z";
      // builtins are always treated as tile calls.
      if (isBuiltin && looksLikeTileCall) return this.parseTileCall();
      // Inside a user tile call, positional args lean towards expressions
      // (so `FilterTab(All)` reads `All` as a variant payload, not a tile reference).
      if (!parentIsBuiltin) return this.parseExpr();
      // Inside a builtin tile, capital-cased identifiers refer to user tiles.
      if (isCapital && looksLikeTileCall) return this.parseTileCall();
      if (isCapital && !looksLikeTileCall) return this.parseTileCall();
    }
    return this.parseExpr();
  }

  private parseTileProp(): TileProp {
    const nameTok = this.peek();
    if (nameTok.kind !== "ident" && nameTok.kind !== "kw") {
      throw new ParseError("Expected prop name", nameTok.pos);
    }
    this.next();
    this.eat("op", ":");
    const value = this.parseExpr();
    return { kind: "TileProp", name: nameTok.value as string, pos: nameTok.pos, value };
  }

  // ----- fn -----

  private parseFn(): FnDef {
    const start = this.eat("kw", "fn");
    const name = this.eat("ident").value;
    this.eat("op", "(");
    const params: { name: string; type: TypeExpr; pos: Pos }[] = [];
    if (!this.matchOp(")")) {
      params.push(this.parseFnParam());
      while (this.matchOp(",")) {
        this.next();
        params.push(this.parseFnParam());
      }
    }
    this.eat("op", ")");
    let ret: TypeExpr | undefined;
    if (this.matchOp("->")) {
      this.next();
      ret = this.parseTypeExpr();
    }
    this.eat("op", "=");
    const body = this.parseExpr();
    const def: FnDef = { kind: "FnDef", name, params, body, pos: start.pos };
    if (ret) (def as FnDef & { ret?: TypeExpr }).ret = ret;
    return def;
  }

  private parseFnParam(): { name: string; type: TypeExpr; pos: Pos } {
    const tok = this.eat("ident");
    this.eat("op", ":");
    const type = this.parseTypeExpr();
    return { name: tok.value, type, pos: tok.pos };
  }

  // ----- effect -----

  private parseEffect(): EffectDef {
    const start = this.eat("kw", "effect");
    const name = this.eat("ident").value;
    let cap: string | undefined;
    let inType: TypeExpr | undefined;
    let outType: TypeExpr | undefined;
    let policy: PolicyExpr | undefined;
    let retry: RetryExpr | undefined;
    let mapRequest: Expr | undefined;

    const duplicateClauses: DuplicateName[] = [];
    const seenClauses = new Set<string>();

    while (this.isEffectField()) {
      const key = this.peek();
      // Same assembly as `app`: one variable per clause, so a second one wins
      // and the first is gone by the time the tree exists.
      if (key.kind === "kw" || key.kind === "ident") {
        if (seenClauses.has(key.value)) duplicateClauses.push({ name: key.value, pos: key.pos });
        seenClauses.add(key.value);
      }
      if (key.kind === "kw" && key.value === "cap") {
        this.next();
        this.eat("op", "=");
        cap = this.readQualifiedName();
      } else if (key.kind === "kw" && key.value === "in") {
        this.next();
        this.eat("op", "=");
        inType = this.parseTypeExpr();
      } else if (key.kind === "kw" && key.value === "out") {
        this.next();
        this.eat("op", "=");
        outType = this.parseTypeExpr();
      } else if (key.kind === "kw" && key.value === "policy") {
        this.next();
        this.eat("op", "=");
        policy = this.parsePolicy();
      } else if (key.kind === "kw" && key.value === "retry") {
        this.next();
        this.eat("op", "=");
        retry = this.parseRetry();
      } else if (key.kind === "ident" && key.value === "map-request") {
        this.next();
        this.eat("op", "=");
        mapRequest = this.parseExpr();
      } else {
        break;
      }
    }

    if (!cap || !inType || !outType) {
      throw new ParseError(`effect requires cap, in, out`, start.pos);
    }
    const def: EffectDef = {
      kind: "EffectDef",
      name,
      cap,
      inType,
      outType,
      pos: start.pos,
    };
    if (policy) def.policy = policy;
    if (retry) def.retry = retry;
    if (mapRequest) def.mapRequest = mapRequest;
    if (duplicateClauses.length > 0) def.duplicateClauses = duplicateClauses;
    return def;
  }

  private isEffectField(): boolean {
    const t = this.peek();
    if (t.kind === "kw" && ["cap", "in", "out", "policy", "retry"].includes(t.value)) {
      return true;
    }
    if (t.kind === "ident" && t.value === "map-request") return true;
    return false;
  }

  private parsePolicy(): PolicyExpr {
    const t = this.eat("ident");
    if (t.value === "latest") return { kind: "PolLatest" };
    if (t.value === "queue") return { kind: "PolQueue" };
    if (t.value === "once") return { kind: "PolOnce" };
    if (t.value === "latest-per-key") {
      this.eat("op", "(");
      const key = this.parseExpr();
      this.eat("op", ")");
      return { kind: "PolLatestKey", key };
    }
    if (t.value === "debounce") {
      this.eat("op", "(");
      const ms = this.parseDuration();
      this.eat("op", ")");
      return { kind: "PolDebounce", ms };
    }
    if (t.value === "throttle") {
      this.eat("op", "(");
      const ms = this.parseDuration();
      this.eat("op", ")");
      return { kind: "PolThrottle", ms };
    }
    throw new ParseError(`Unknown policy "${t.value}"`, t.pos);
  }

  private parseRetry(): RetryExpr {
    const t = this.eat("ident");
    if (t.value === "none") return { kind: "RetryNone" };
    if (t.value === "linear") {
      this.eat("op", "(");
      const n = this.eatRetryCount();
      this.eat("op", ",");
      const ms = this.parseDuration();
      this.eat("op", ")");
      return { kind: "RetryLinear", n, ms };
    }
    if (t.value === "exponential") {
      this.eat("op", "(");
      const n = this.eatRetryCount();
      this.eat("op", ",");
      const ms = this.parseDuration();
      this.eat("op", ",");
      const factor = this.eatRetryFactor();
      this.eat("op", ")");
      return { kind: "RetryExp", n, ms, factor };
    }
    throw new ParseError(`Unknown retry "${t.value}"`, t.pos);
  }

  /**
   * A retry count. Signed, because `§1.2` makes a sign part of a number
   * literal and `Expected num, got op(-)` said nothing about what is wrong with
   * one — and then rejected, because a negative count is not a shorter retry
   * policy, it is a policy that cannot run. Whole, for the same reason: 2.5
   * attempts is not a number of attempts.
   */
  private eatRetryCount(): number {
    const t = this.peek();
    const n = this.eatSignedNumber();
    if (n < 0 || !Number.isInteger(n)) {
      throw new ParseError(`Retry count must be a whole number, 0 or more (got ${n})`, t.pos);
    }
    return n;
  }

  /**
   * A retry backoff factor — a multiplier, so signed like every other literal
   * and then held to being one.
   */
  private eatRetryFactor(): number {
    const t = this.peek();
    const n = this.eatSignedNumber();
    if (n <= 0) {
      throw new ParseError(`Retry factor must be greater than 0 (got ${n})`, t.pos);
    }
    return n;
  }

  /** A number literal with the sign the lexer emits as its own operator. */
  private eatSignedNumber(): number {
    if (this.matchOp("-") && this.matchTAt(1, "num")) {
      this.next();
      return -this.eat("num").value;
    }
    return this.eat("num").value;
  }

  private parseDuration(): number {
    const numTok = this.peek();
    const n = this.eatSignedNumber();
    const unitTok = this.eat("ident");
    const unit = unitTok.value;
    // A duration is a length of time, and the runtime reads every one of them
    // as a delay: `setInterval(f, -1000)` is clamped to the minimum, so
    // `on=timer(-1s)` would fire a "once a second" reducer hundreds of times a
    // second. `§1.2` makes the sign part of the literal, so the grammar admits
    // it and the meaning is what rejects it.
    if (n < 0) {
      throw new ParseError(`Duration must be 0 or more (got ${n})`, numTok.pos);
    }
    if (unit === "ms") return n;
    if (unit === "s") return n * 1000;
    if (unit === "m") return n * 60 * 1000;
    // At the unit, not at whatever follows it: the unit is what has to change.
    throw new ParseError(`Unknown duration unit "${unit}"`, unitTok.pos);
  }

  // ----- app -----

  private parseApp(): AppDef {
    const start = this.eat("kw", "app");
    const name = this.eat("ident").value;
    let caps: string[] = [];
    let routes: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] = [];
    let init: Expr[] = [];
    let theme: NamedRef | undefined;
    let http: AppHttpConfig | undefined;
    let indexedDb: AppIndexedDbConfig | undefined;
    let meta: AppMetaConfig | undefined;
    let analytics: AppAnalyticsConfig | undefined;

    const duplicateClauses: DuplicateName[] = [];
    const seenClauses = new Set<string>();
    const configSources: Expr[] = [];

    while (!this.isAppEnd()) {
      const ident = this.eat("ident");
      const k = ident.value;
      // Each clause is assigned into a single variable, so a second one
      // overwrites the first and leaves nothing behind — for `caps` that means
      // the declared capability set depends silently on clause order.
      if (seenClauses.has(k)) duplicateClauses.push({ name: k, pos: ident.pos });
      seenClauses.add(k);
      this.eat("op", "=");
      if (k === "caps") caps = this.parseQualifiedList();
      else if (k === "routes") routes = this.parseRouteMap();
      else if (k === "init") init = this.parseInitList();
      else if (k === "theme") {
        const tok = this.eat("ident");
        theme = { name: tok.value, pos: tok.pos };
      } else if (k === "http") http = this.parseAppHttp(ident.pos, configSources);
      else if (k === "indexed-db") indexedDb = this.parseAppIndexedDb(ident.pos, configSources);
      else if (k === "meta") meta = this.parseAppMeta(ident.pos, configSources);
      else if (k === "analytics") analytics = this.parseAppAnalytics(ident.pos, configSources);
      else {
        throw new ParseError(`Unknown app field "${k}"`, ident.pos);
      }
    }

    const def: AppDef = { kind: "AppDef", name, caps, routes, init, pos: start.pos };
    if (duplicateClauses.length > 0) def.duplicateClauses = duplicateClauses;
    if (configSources.length > 0) def.configSources = configSources;
    if (theme) def.theme = theme;
    if (http) def.http = http;
    if (indexedDb) def.indexedDb = indexedDb;
    if (meta) def.meta = meta;
    if (analytics) def.analytics = analytics;
    return def;
  }

  // app.meta = { title?, description?, og-image?, favicon? } — spec style.md §4.10.
  private parseAppMeta(pos: Pos, sources: Expr[]): AppMetaConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.meta must be a record literal`, pos);
    }
    const cfg: AppMetaConfig = { pos };
    for (const f of rec.fields) {
      const v = f.value;
      if (v.kind !== "Str") {
        throw new ParseError(`app.meta.${f.name} must be a string literal`, v.pos);
      }
      switch (f.name) {
        case "title":
          cfg.title = v.value;
          break;
        case "description":
          cfg.description = v.value;
          break;
        case "og-image":
          cfg.ogImage = v.value;
          break;
        case "favicon":
          cfg.favicon = v.value;
          break;
        default:
          throw new ParseError(`Unknown app.meta field "${f.name}"`, v.pos);
      }
    }
    return cfg;
  }

  // app.analytics = { provider: "console" | "noop", app-id? } — spec runtime.md §10.4.6.
  private parseAppAnalytics(pos: Pos, sources: Expr[]): AppAnalyticsConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.analytics must be a record literal`, pos);
    }
    let provider: "console" | "noop" | undefined;
    let appId: string | undefined;
    for (const f of rec.fields) {
      const v = f.value;
      if (f.name === "provider") {
        if (v.kind !== "Str" || (v.value !== "console" && v.value !== "noop")) {
          throw new ParseError(`app.analytics.provider must be "console" or "noop"`, v.pos);
        }
        provider = v.value;
      } else if (f.name === "app-id") {
        if (v.kind !== "Str") {
          throw new ParseError(`app.analytics.app-id must be a string literal`, v.pos);
        }
        appId = v.value;
      } else {
        throw new ParseError(`Unknown app.analytics field "${f.name}"`, v.pos);
      }
    }
    if (provider === undefined) {
      throw new ParseError(`app.analytics requires a "provider" field`, pos);
    }
    const cfg: AppAnalyticsConfig = { provider, pos };
    if (appId !== undefined) cfg.appId = appId;
    return cfg;
  }

  // app.indexed-db = { name, version, stores: [{ name, key, indexes? }] } — spec http.md §6.7.4.
  private parseAppIndexedDb(pos: Pos, sources: Expr[]): AppIndexedDbConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.indexed-db must be a record literal`, pos);
    }
    let dbName: string | undefined;
    let version: number | undefined;
    const stores: AppIndexedDbStore[] = [];
    for (const f of rec.fields) {
      if (f.name === "name") {
        if (f.value.kind !== "Str") {
          throw new ParseError(`app.indexed-db.name must be a string literal`, f.value.pos);
        }
        dbName = f.value.value;
      } else if (f.name === "version") {
        if (f.value.kind !== "Num") {
          throw new ParseError(`app.indexed-db.version must be a numeric literal`, f.value.pos);
        }
        version = f.value.value;
      } else if (f.name === "stores") {
        if (f.value.kind !== "ListLit") {
          throw new ParseError(`app.indexed-db.stores must be a list literal`, f.value.pos);
        }
        for (const item of f.value.items) {
          stores.push(this.parseIndexedDbStore(item));
        }
      } else {
        throw new ParseError(`Unknown app.indexed-db field "${f.name}"`, pos);
      }
    }
    if (dbName === undefined) {
      throw new ParseError(`app.indexed-db requires a "name" field`, pos);
    }
    if (version === undefined) {
      throw new ParseError(`app.indexed-db requires a "version" field`, pos);
    }
    if (stores.length === 0) {
      throw new ParseError(`app.indexed-db requires at least one store`, pos);
    }
    return { name: dbName, version, stores, pos };
  }

  private parseIndexedDbStore(expr: Expr): AppIndexedDbStore {
    if (expr.kind !== "RecordLit") {
      throw new ParseError(`indexed-db store must be a record literal`, expr.pos);
    }
    let name: string | undefined;
    let key: string | undefined;
    let indexes: string[] | undefined;
    for (const f of expr.fields) {
      if (f.name === "name") {
        if (f.value.kind !== "Str") {
          throw new ParseError(`indexed-db store "name" must be a string literal`, f.value.pos);
        }
        name = f.value.value;
      } else if (f.name === "key") {
        if (f.value.kind !== "Str") {
          throw new ParseError(`indexed-db store "key" must be a string literal`, f.value.pos);
        }
        key = f.value.value;
      } else if (f.name === "indexes") {
        if (f.value.kind !== "ListLit") {
          throw new ParseError(`indexed-db store "indexes" must be a list literal`, f.value.pos);
        }
        indexes = f.value.items.map((it) => {
          if (it.kind !== "Str") {
            throw new ParseError(`indexed-db store index must be a string literal`, it.pos);
          }
          return it.value;
        });
      } else {
        throw new ParseError(`Unknown indexed-db store field "${f.name}"`, expr.pos);
      }
    }
    if (name === undefined) {
      throw new ParseError(`indexed-db store requires a "name" field`, expr.pos);
    }
    if (key === undefined) {
      throw new ParseError(`indexed-db store requires a "key" field`, expr.pos);
    }
    const store: AppIndexedDbStore = { name, key };
    if (indexes) store.indexes = indexes;
    return store;
  }

  // app.http = { base-url, headers, on-401, on-403, on-5xx, timeout, credentials } — spec http.md §6.3.
  // headers is kept as Expr so the codegen can wrap it in a closure (slot
  // references must re-evaluate on every request, not freeze at mount).
  private parseAppHttp(pos: Pos, sources: Expr[]): AppHttpConfig {
    const rec = this.parseExpr();
    sources.push(rec);
    if (rec.kind !== "RecordLit") {
      throw new ParseError(`app.http must be a record literal`, pos);
    }
    const cfg: AppHttpConfig = { pos };
    for (const f of rec.fields) {
      switch (f.name) {
        case "base-url":
          cfg.baseUrl = f.value;
          break;
        case "headers":
          cfg.headers = f.value;
          break;
        case "on-401":
          cfg.on401 = this.appHttpReducerRef(f.name, f.value);
          break;
        case "on-403":
          cfg.on403 = this.appHttpReducerRef(f.name, f.value);
          break;
        case "on-5xx":
          cfg.on5xx = this.appHttpReducerRef(f.name, f.value);
          break;
        case "timeout":
          cfg.timeout = f.value;
          break;
        case "credentials":
          cfg.credentials = f.value;
          break;
        default:
          throw new ParseError(`Unknown app.http field "${f.name}"`, pos);
      }
    }
    return cfg;
  }

  private appHttpReducerRef(field: string, value: Expr): NamedRef {
    if (value.kind !== "Ref") {
      throw new ParseError(`app.http.${field} must be a reducer name (bare identifier)`, value.pos);
    }
    return { name: value.name, pos: value.pos };
  }

  private isAppEnd(): boolean {
    const t = this.peek();
    if (t.kind === "eof") return true;
    if (t.kind === "kw") return true;
    // `theme` and `motion` are the two definition heads that are not reserved
    // words, because `theme = T` is also an `app` clause. The shape tells them
    // apart: a definition names itself first (`theme T = …`), a clause assigns
    // straight away (`theme = T`). Without this an `app` written before either
    // one ate it as a clause of its own, though §1.1 says definitions are
    // unordered.
    if (t.kind === "ident" && (t.value === "theme" || t.value === "motion")) {
      return this.matchTAt(1, "ident") && this.matchTAt(2, "op", "=");
    }
    return false;
  }

  // ----- test -----

  private parseTest(): TestDef {
    const start = this.eat("kw", "test");
    const name = this.eat("ident").value;
    this.eat("op", "=");
    const kindTok = this.eat("ident");
    if (kindTok.value === "property-test") {
      return this.parsePropertyTest(name, start.pos);
    }
    if (kindTok.value === "episode-test") {
      return this.parseEpisodeTest(name, start.pos);
    }
    if (kindTok.value !== "reducer-test" && kindTok.value !== "tile-test") {
      throw new ParseError(
        `Unknown test kind "${kindTok.value}" (expected reducer-test, tile-test, episode-test, or property-test)`,
        kindTok.pos,
      );
    }
    const targetTok = this.eat("ident");
    const target = targetTok.value;

    const givenKw = this.eat("ident");
    if (givenKw.value !== "given") {
      throw new ParseError(`Expected "given" in test "${name}"`, givenKw.pos);
    }
    this.eat("op", "=");
    const given = this.parseExpr();

    const expectKw = this.eat("ident");
    if (expectKw.value !== "expect") {
      throw new ParseError(`Expected "expect" in test "${name}"`, expectKw.pos);
    }
    this.eat("op", "=");
    const expect = kindTok.value === "tile-test" ? this.parseTileExpr() : this.parseExpr();

    return {
      kind: "TestDef",
      name,
      testKind: kindTok.value,
      target,
      targetPos: targetTok.pos,
      given,
      expect,
      pos: start.pos,
    };
  }

  /** `property-test for-all={n: T, …} given={…} invariant=expr (count=int)? (shrink=bool)?` */
  private parsePropertyTest(name: string, pos: Pos): TestDef {
    this.expectIdent("for-all", name);
    this.eat("op", "=");
    const forAll = this.parseForAllRecord();

    this.expectIdent("given", name);
    this.eat("op", "=");
    const given = this.parseExpr();

    this.expectIdent("invariant", name);
    this.eat("op", "=");
    const invariant = this.parseExpr();

    let count: number | undefined;
    let shrink: boolean | undefined;
    // Optional `count = int` / `shrink = bool`, in any order.
    while (this.matchT("ident", "count") || this.matchT("ident", "shrink")) {
      const kw = this.next();
      this.eat("op", "=");
      if ("value" in kw && kw.value === "count") {
        const n = this.eat("num");
        count = n.value;
      } else {
        const b = this.peek();
        if (b.kind === "kw" && (b.value === "true" || b.value === "false")) {
          this.next();
          shrink = b.value === "true";
        } else {
          throw new ParseError(`property-test "${name}" shrink must be true/false`, b.pos);
        }
      }
    }

    return {
      kind: "TestDef",
      name,
      testKind: "property-test",
      given,
      forAll,
      invariant,
      ...(count !== undefined ? { count } : {}),
      ...(shrink !== undefined ? { shrink } : {}),
      pos,
    };
  }

  /** `episode-test load="<path>" mocks={...} expect={...}` (spec §8.6). */
  private parseEpisodeTest(name: string, pos: Pos): TestDef {
    this.expectIdent("load", name);
    this.eat("op", "=");
    const strTok = this.eat("str");
    const load = strTok.value;

    this.expectIdent("mocks", name);
    this.eat("op", "=");
    const mocks = this.parseExpr();

    this.expectIdent("expect", name);
    this.eat("op", "=");
    const expect = this.parseExpr();

    return {
      kind: "TestDef",
      name,
      testKind: "episode-test",
      // `given` is unused for episode-test (the log IS the given) but the AST
      // requires it; supply a synthetic empty record so downstream visitors
      // that walk every TestDef.given do not have to special-case undefined.
      given: { kind: "RecordLit", fields: [], pos },
      load,
      mocks,
      expect,
      pos,
    };
  }

  private expectIdent(word: string, testName: string): void {
    const t = this.eat("ident");
    if (t.value !== word) {
      throw new ParseError(`Expected "${word}" in test "${testName}"`, t.pos);
    }
  }

  /** `{ name: TypeExpr, … }` — the `for-all` generators (types, not values). */
  private parseForAllRecord(): { name: string; type: TypeExpr; pos: Pos }[] {
    this.eat("op", "{");
    const out: { name: string; type: TypeExpr; pos: Pos }[] = [];
    if (!this.matchOp("}")) {
      while (true) {
        const id = this.eat("ident");
        this.eat("op", ":");
        const type = this.parseTypeExpr();
        out.push({ name: id.value, type, pos: id.pos });
        if (!this.matchOp(",")) break;
        this.next();
      }
    }
    this.eat("op", "}");
    return out;
  }

  private parseQualifiedList(): string[] {
    this.eat("op", "[");
    const out: string[] = [];
    if (!this.matchOp("]")) {
      out.push(this.readQualifiedName());
      while (this.matchOp(",")) {
        this.next();
        out.push(this.readQualifiedName());
      }
    }
    this.eat("op", "]");
    return out;
  }

  private readQualifiedName(): string {
    let name = this.eat("ident").value;
    while (this.matchOp(".")) {
      this.next();
      // A segment after `.` is a name in the capability's own namespace, not in
      // the language's, so a keyword there is unambiguous — and
      // `caps=[telemetry.out]` was otherwise unwritable.
      name += `.${this.eatName().value}`;
    }
    return name;
  }

  /** An identifier, or a keyword used where only a name can appear. */
  private eatName(): { value: string; pos: Pos } {
    const t = this.peek();
    if (t.kind === "kw") {
      this.next();
      return { value: t.value, pos: t.pos };
    }
    return this.eat("ident");
  }

  private parseRouteMap(): { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] {
    this.eat("op", "{");
    const routes: { path: string; tile: string; tilePos?: Pos; pathPos: Pos }[] = [];
    if (!this.matchOp("}")) {
      routes.push(this.parseRouteEntry());
      while (this.matchOp(",")) {
        this.next();
        routes.push(this.parseRouteEntry());
      }
    }
    this.eat("op", "}");
    return routes;
  }

  private parseRouteEntry(): { path: string; tile: string; tilePos?: Pos; pathPos: Pos } {
    const pathTok = this.eat("str");
    const path = pathTok.value;
    if (this.matchOp("->>")) {
      this.next();
      // redirect target as string. Represent it as a tile name.
      const target = this.eat("str").value;
      return { path, tile: `>>${target}`, pathPos: pathTok.pos };
    }
    this.eat("op", "->");
    const tok = this.eat("ident");
    return { path, tile: tok.value, tilePos: tok.pos, pathPos: pathTok.pos };
  }

  private parseInitList(): Expr[] {
    this.eat("op", "[");
    const out: Expr[] = [];
    if (!this.matchOp("]")) {
      out.push(this.parseExpr());
      while (this.matchOp(",")) {
        this.next();
        out.push(this.parseExpr());
      }
    }
    this.eat("op", "]");
    return out;
  }
}

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram();
}

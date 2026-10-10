import type {
  Def,
  DuplicateName,
  EffectDef,
  Expr,
  FnDef,
  MotionDef,
  PolicyExpr,
  Pos,
  Program,
  ReducerDef,
  RetryExpr,
  SlotDef,
  Statement,
  TestDef,
  ThemeDef,
  ThemeValue,
  TileDef,
  Token,
  TypeDef,
  TypeExpr,
} from "../ast.ts";
import { isPositiveInt } from "../positive-int.ts";
import { AppParser } from "./app.ts";
import { ParseError } from "./token-stream.ts";

export class Parser extends AppParser {
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
    [k: string]: ThemeValue;
  } {
    return this.descend(() => this.parseThemeRecordNested(duplicates));
  }

  private parseThemeRecordNested(duplicates: DuplicateName[]): {
    [k: string]: ThemeValue;
  } {
    this.eat("op", "{");
    const out: { [k: string]: ThemeValue } = Object.create(null);
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

  private parseThemeEntry(out: { [k: string]: ThemeValue }, duplicates: DuplicateName[]): void {
    const keyTok = this.peek();
    if (keyTok.kind !== "ident" && keyTok.kind !== "kw" && keyTok.kind !== "str") {
      throw new ParseError(`Expected theme key`, keyTok.pos);
    }
    this.next();
    const key = keyTok.value as string;
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

  private eatRetryCount(): number {
    const t = this.peek();
    const n = this.eatSignedNumber();
    if (n < 0 || !Number.isInteger(n)) {
      throw new ParseError(`Retry count must be a whole number, 0 or more (got ${n})`, t.pos);
    }
    return n;
  }

  private eatRetryFactor(): number {
    const t = this.peek();
    const n = this.eatSignedNumber();
    if (n <= 0) {
      throw new ParseError(`Retry factor must be greater than 0 (got ${n})`, t.pos);
    }
    return n;
  }

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
        count = this.eatPropertyTestCount(name);
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

  // A count of 0 runs no case and would report the property as holding having
  // checked nothing; signed so `-3` gets this message rather than `Expected num`.
  private eatPropertyTestCount(name: string): number {
    const t = this.peek();
    const n = this.eatSignedNumberLit();
    if (!isPositiveInt(n.value)) {
      throw new ParseError(
        `property-test "${name}" count must be a whole number, 1 or more (got ${n.raw})`,
        t.pos,
      );
    }
    return n.value;
  }

  /** `episode-test load="<path>" mocks={...} expect={...}`. */
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
}

import type {
  EventPattern,
  Expr,
  Lvalue,
  NamedRef,
  Pattern,
  Pos,
  Statement,
  UiEventKind,
} from "../ast.ts";
import { ExpressionParser } from "./expressions.ts";
import { ParseError } from "./token-stream.ts";

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

export class StatementParser extends ExpressionParser {
  protected statementLookahead(): boolean {
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
      const j = this.i + 1;
      while (j < this.tokens.length) {
        const t = this.tokens[j]!;
        if (t.kind === "op" && (t.value === ":=" || t.value === "[" || t.value === "."))
          return true;
        if (t.kind === "op" && (t.value === ":=" || t.value === "(")) return true;
        if (t.kind === "kw") return false;
        if (t.kind === "ident") return false;
        if (t.kind === "eof") return false;
        return false;
      }
    }
    return false;
  }

  protected parseEventPattern(): EventPattern {
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
      if (sub === "ok" || sub === "err") {
        this.eat("op", "(");
        const binds: NamedRef[] = [];
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

  protected readBind(): NamedRef {
    if (this.matchOp("_")) {
      const tok = this.next();
      return { name: "_", pos: tok.pos };
    }
    if (this.matchT("ident", "_")) {
      const tok = this.next();
      return { name: "_", pos: tok.pos };
    }
    const tok = this.eat("ident");
    return { name: tok.value, pos: tok.pos };
  }

  protected parseStatement(): Statement {
    return this.descend(() => this.parseStatementNested());
  }

  protected parseStatementNested(): Statement {
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
    if (cur.kind === "ident" && cur.value === "panic" && this.matchTAt(1, "op", "(")) {
      this.next();
      this.eat("op", "(");
      const message = this.parseExpr();
      this.eat("op", ")");
      return { kind: "PanicStmt", message, pos: cur.pos };
    }
    const lvalue = this.parseLvalue();
    this.eat("op", ":=");
    const rhs = this.parseExpr();
    return { kind: "SlotAssign", lvalue, rhs, pos: lvalue.pos };
  }

  protected parseStatementBody(): Statement[] {
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

  protected parseLvalue(): Lvalue {
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
}

import type { Expr, Lvalue, ReducerDef, Statement } from "../ast.ts";
import { type EvalCtx, type GenCtx, jsName, makeEvalCtx } from "./context.ts";
import { jsOfExpr, reducerNameArg, tupleArm } from "./expr.ts";

/** All effect names emitted anywhere in a reducer body (descends into control flow). */
export function collectEmits(stmts: Statement[]): string[] {
  const out: string[] = [];
  const visitExpr = (e: Expr | undefined): void => {
    if (!e) return;
    switch (e.kind) {
      case "BinOp":
        visitExpr(e.lhs);
        visitExpr(e.rhs);
        return;
      case "UnaryOp":
        visitExpr(e.rhs);
        return;
      case "FieldAccess":
        visitExpr(e.base);
        return;
      case "Index":
        visitExpr(e.base);
        visitExpr(e.index);
        return;
      case "Call":
        for (const a of e.args) visitExpr(a);
        return;
      case "MethodCall":
        visitExpr(e.receiver);
        for (const a of e.args) visitExpr(a);
        return;
      case "RecordLit":
        for (const f of e.fields) visitExpr(f.value);
        return;
      case "ListLit":
        for (const it of e.items) visitExpr(it);
        return;
      case "MapLit":
        for (const en of e.entries) {
          visitExpr(en.key);
          visitExpr(en.value);
        }
        return;
      case "MatchExpr":
        visitExpr(e.scrutinee);
        for (const a of e.arms) visitExpr(a.body);
        return;
      case "IfExpr":
        visitExpr(e.cond);
        visitExpr(e.consequent);
        visitExpr(e.alternate);
        return;
      case "LetIn":
        visitExpr(e.value);
        visitExpr(e.body);
        return;
      case "Variant":
        for (const p of e.payload) visitExpr(p);
        return;
      case "EmitExpr":
        out.push(e.effect);
        for (const a of e.args) visitExpr(a);
        return;
    }
  };
  const walk = (ss: Statement[]): void => {
    for (const s of ss) {
      if (s.kind === "Emit") {
        out.push(s.effect);
        for (const a of s.args) visitExpr(a);
      } else if (s.kind === "LetStmt") visitExpr(s.rhs);
      else if (s.kind === "SlotAssign") visitExpr(s.rhs);
      else if (s.kind === "ForStmt") {
        visitExpr(s.iter);
        walk(s.body);
      } else if (s.kind === "IfStmt") {
        visitExpr(s.cond);
        walk(s.consequent);
        walk(s.alternate);
      } else if (s.kind === "MatchStmt") {
        visitExpr(s.scrutinee);
        for (const a of s.arms) walk(a.body);
      }
    }
  };
  walk(stmts);
  return out;
}

/** Invoke `cb` with each `run-reducer(name)` target inside an expression. */
export function scanRunReducers(e: Expr | undefined, cb: (name: string) => void): void {
  if (!e) return;
  if (e.kind === "Call" && e.callee === "run-reducer") cb(reducerNameArg(e.args[0]));
  if (e.kind === "MethodCall" && e.method === "run-reducer") cb(reducerNameArg(e.args[0]));
  switch (e.kind) {
    case "BinOp":
      scanRunReducers(e.lhs, cb);
      scanRunReducers(e.rhs, cb);
      break;
    case "UnaryOp":
      scanRunReducers(e.rhs, cb);
      break;
    case "FieldAccess":
      scanRunReducers(e.base, cb);
      break;
    case "Index":
      scanRunReducers(e.base, cb);
      scanRunReducers(e.index, cb);
      break;
    case "Call":
      for (const a of e.args) scanRunReducers(a, cb);
      break;
    case "MethodCall":
      scanRunReducers(e.receiver, cb);
      for (const a of e.args) scanRunReducers(a, cb);
      break;
    case "RecordLit":
      for (const f of e.fields) scanRunReducers(f.value, cb);
      break;
    case "ListLit":
      for (const it of e.items) scanRunReducers(it, cb);
      break;
    case "MapLit":
      for (const en of e.entries) {
        scanRunReducers(en.key, cb);
        scanRunReducers(en.value, cb);
      }
      break;
    case "MatchExpr":
      scanRunReducers(e.scrutinee, cb);
      for (const a of e.arms) scanRunReducers(a.body, cb);
      break;
    case "IfExpr":
      scanRunReducers(e.cond, cb);
      scanRunReducers(e.consequent, cb);
      scanRunReducers(e.alternate, cb);
      break;
    case "LetIn":
      scanRunReducers(e.value, cb);
      scanRunReducers(e.body, cb);
      break;
    case "Variant":
      for (const p of e.payload) scanRunReducers(p, cb);
      break;
  }
}

export function genReducer(r: ReducerDef, gen: GenCtx): string {
  const locals = new Set<string>(["$el", "$event", "$route"]);
  if (r.on.kind === "EffectEvent") for (const b of r.on.binds) if (b !== "_") locals.add(b);
  const ctx = makeEvalCtx(gen, locals, true);

  // event descriptor
  let eventJs: string;
  let selectorJs = "undefined";
  if (r.on.kind === "UiEvent") {
    eventJs = `{ kind: "ui", ev: ${JSON.stringify(r.on.ev)} }`;
    selectorJs = `{ tile: ${JSON.stringify(r.on.selector.tile)}${r.on.selector.id ? `, id: ${JSON.stringify(r.on.selector.id)}` : ""} }`;
  } else if (r.on.kind === "EffectEvent") {
    eventJs = `{ kind: "effect", effect: ${JSON.stringify(r.on.effect)}, outcome: ${JSON.stringify(r.on.outcome)} }`;
  } else if (r.on.kind === "TimerEvent") {
    const nameJs = r.on.name !== undefined ? `, name: ${JSON.stringify(r.on.name)}` : "";
    eventJs = `{ kind: "timer", intervalMs: ${r.on.intervalMs}${nameJs} }`;
  } else {
    eventJs = `{ kind: "lifecycle", name: ${JSON.stringify(r.on.name)} }`;
  }

  // emits collection
  const stmtLines: string[] = [];
  stmtLines.push(`const _next = {};`);
  stmtLines.push(`const _emits = [];`);
  stmtLines.push(`const _stops = [];`);
  // bind payload positional args. For effect events, $1, $2, etc. are payload props.
  if (r.on.kind === "EffectEvent") {
    for (let i = 0; i < r.on.binds.length; i++) {
      const name = r.on.binds[i]!;
      if (name === "_") continue;
      stmtLines.push(`const ${jsName(name)} = _payload[${JSON.stringify(`$${i + 1}`)}];`);
    }
  }
  stmtLines.push(`const ${jsName("$el")} = _payload.$el || {};`);
  stmtLines.push(`const ${jsName("$event")} = _payload.$event || _payload || {};`);
  stmtLines.push(`const ${jsName("$route")} = _payload.$route || {};`);

  for (const st of r.do) stmtLines.push(genStatement(st, ctx));

  stmtLines.push(`return { slots: _next, emits: _emits, stopTimers: _stops };`);

  return `  {
    name: ${JSON.stringify(r.name)},
    selector: ${selectorJs},
    event: ${eventJs},
    apply: (_slotsLive, _payload) => {
      ${stmtLines.join("\n      ")}
    },
  },`;
}

export function genStatement(s: Statement, ctx: EvalCtx): string {
  if (s.kind === "ForStmt") {
    const iter = jsOfExpr(s.iter, ctx);
    const inner = makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
    inner.localBinds.add(s.bind);
    const body = s.body.map((b) => genStatement(b, inner)).join("\n  ");
    return `for (const ${jsName(s.bind)} of ((${iter}) || [])) {\n  ${body}\n}`;
  }
  if (s.kind === "IfStmt") {
    const cond = jsOfExpr(s.cond, ctx);
    const thenBody = s.consequent.map((b) => genStatement(b, ctx)).join("\n  ");
    const elseBody = s.alternate.map((b) => genStatement(b, ctx)).join("\n  ");
    return `if (${cond}) {\n  ${thenBody}\n} else {\n  ${elseBody}\n}`;
  }
  if (s.kind === "MatchStmt") {
    const sc = jsOfExpr(s.scrutinee, ctx);
    const arms = s.arms
      .map((arm) => {
        if (arm.pattern.kind === "PVariant") {
          const inner = makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
          for (const b of arm.pattern.binds) if (b !== "_") inner.localBinds.add(b);
          const binds = arm.pattern.binds
            .map((b, i) =>
              b !== "_" ? `const ${jsName(b)} = _v[${JSON.stringify(`_${i}`)}];` : "",
            )
            .join(" ");
          const body = arm.body.map((b) => genStatement(b, inner)).join("\n  ");
          return `if (_s.variantIs(_v, ${JSON.stringify(arm.pattern.name)})) { ${binds}\n  ${body}\n}`;
        }
        if (arm.pattern.kind === "PBind") {
          const inner = makeEvalCtx(ctx.gen, ctx.localBinds, ctx.reducerScope);
          inner.localBinds.add(arm.pattern.name);
          const body = arm.body.map((b) => genStatement(b, inner)).join("\n  ");
          return `if (true) { const ${jsName(arm.pattern.name)} = _v;\n  ${body}\n}`;
        }
        if (arm.pattern.kind === "PTuple") {
          const { guard, binds, inner } = tupleArm(arm.pattern, ctx, "_v", true);
          const body = arm.body.map((b) => genStatement(b, inner)).join("\n  ");
          return `if (${guard}) { ${binds}\n  ${body}\n}`;
        }
        const body = arm.body.map((b) => genStatement(b, ctx)).join("\n  ");
        return `if (true) {\n  ${body}\n}`;
      })
      .join(" else ");
    return `{ const _v = ${sc};\n  ${arms}\n}`;
  }
  if (s.kind === "NoopStmt") {
    return `/* no-op */`;
  }
  if (s.kind === "LetStmt") {
    const rhs = jsOfExpr(s.rhs, ctx);
    ctx.localBinds.add(s.name);
    return `const ${jsName(s.name)} = ${rhs};`;
  }
  if (s.kind === "Emit") {
    // `confirm` (lifecycle §7.6) carries `onYes`/`onNo` reducer references —
    // bare identifiers naming a top-level reducer. Encode those fields as
    // string literals so the runtime can dispatch by name; everything else
    // (title/message and any non-Ref values) takes the normal expression path.
    if (s.effect === "confirm") {
      const args = s.args.map((a) => jsOfConfirmArg(a, ctx)).join(", ");
      return `_emits.push({ effect: "confirm", args: [${args}] });`;
    }
    const args = s.args.map((a) => jsOfExpr(a, ctx)).join(", ");
    return `_emits.push({ effect: ${JSON.stringify(s.effect)}, args: [${args}] });`;
  }
  if (s.kind === "StopTimer") {
    return `_stops.push(${JSON.stringify(s.name)});`;
  }
  return genSlotAssign(s.lvalue, s.rhs, ctx);
}

export function genSlotAssign(lv: Lvalue, rhs: Expr, ctx: EvalCtx): string {
  const rhsJs = jsOfExpr(rhs, ctx);
  if (lv.kind === "LSlot") {
    return `_next[${JSON.stringify(lv.name)}] = ${rhsJs};`;
  }
  // Build update for nested lvalue.
  // The root slot name + path → produce a new object.
  const root = lvalueRootName(lv);
  const path: ({ kind: "field"; name: string } | { kind: "index"; expr: Expr })[] = [];
  let cur: Lvalue = lv;
  while (cur.kind !== "LSlot") {
    if (cur.kind === "LField") path.unshift({ kind: "field", name: cur.field });
    else path.unshift({ kind: "index", expr: cur.index });
    cur = cur.base;
  }
  // Generate an inline `setPath(root, path, value)` expression. Inside a reducer
  // body we read from `_next` first so successive writes in a `for` loop see
  // the previous iteration's updates.
  const rootKey = JSON.stringify(root);
  const baseJs = ctx.reducerScope
    ? `(((_next[${rootKey}] !== undefined) ? _next[${rootKey}] : _live[${rootKey}]) ?? {})`
    : `(_live[${rootKey}] ?? {})`;
  let pathExpr = "";
  for (const seg of path) {
    if (seg.kind === "field") pathExpr += `, ${JSON.stringify(seg.name)}`;
    else pathExpr += `, ${jsOfExpr(seg.expr, ctx)}`;
  }
  return `_next[${JSON.stringify(root)}] = _setPath(${baseJs}, [${pathExpr.replace(/^, /, "")}], ${rhsJs});`;
}

export function lvalueRootName(lv: Lvalue): string {
  while (lv.kind !== "LSlot") lv = lv.base;
  return lv.name;
}

/**
 * Encode an argument to `emit confirm`. The single positional arg is a record
 * literal whose `onYes` / `onNo` fields name reducers; encode those as string
 * literals so the runtime can dispatch by name. Everything else falls back to
 * the normal expression path.
 */
export function jsOfConfirmArg(a: Expr, ctx: EvalCtx): string {
  if (a.kind !== "RecordLit") return jsOfExpr(a, ctx);
  const parts = a.fields.map((f) => {
    const v = f.value;
    if ((f.name === "onYes" || f.name === "onNo") && v.kind === "Ref") {
      const refName = v.name;
      const isReducer = ctx.gen.reducers?.some((r) => r.name === refName);
      if (isReducer) {
        return `${JSON.stringify(f.name)}: ${JSON.stringify(refName)}`;
      }
    }
    return `${JSON.stringify(f.name)}: ${jsOfExpr(v, ctx)}`;
  });
  return `{ ${parts.join(", ")} }`;
}

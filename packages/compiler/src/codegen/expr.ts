import type { Expr, KeyKind, Pattern, Pos } from "../ast.ts";
import { type ParseReading, parseQualifier } from "../parse-reading.ts";
import {
  addBind,
  bindRef,
  declareBind,
  type EvalCtx,
  type GenCtx,
  jsBinding,
  jsProperty,
  makeEvalCtx,
} from "./context.ts";
import { refinementJs } from "./emit-type.ts";

/** Extract the reducer name from a `run-reducer(name)` argument (a bare ref). */
export function reducerNameArg(e: Expr | undefined): string {
  if (e?.kind === "Ref") return e.name;
  if (e?.kind === "Variant") return e.name;
  return "";
}

/**
 * The argument a builtin's lowering reads, which every one of them requires.
 *
 * These used to substitute a default for a missing one — `0` for a duration,
 * `""` for a byte string, `undefined` for a file — so an omission became a
 * plausible value instead of a diagnostic: `Duration.s()` was zero
 * milliseconds, which is a timer that fires immediately and forever.
 *
 * `checkCallee` reports E0213 wherever `checkExpr` walks, and this throw is
 * the guard for a call that arrives without having been walked at all —
 * `codegen()` can be called without `check()`. The position is interpolated
 * because a plain `Error` carries none, and an error that cannot say where it
 * came from is the failure this file is otherwise closing.
 */
function requiredArg(callee: string, args: Expr[], pos: Pos, ctx: EvalCtx): string {
  const arg = args[0];
  if (!arg) {
    throw new Error(
      `${callee}() at ${pos.line}:${pos.col} is missing its argument — run \`check\` for the diagnostic`,
    );
  }
  return jsOfExpr(arg, ctx);
}

/** The lowering of one reading: text in, `Some(value)` or `None` out. */
function readingJs(reading: ParseReading, a: string): string {
  switch (reading) {
    // Decimal only, and exact like `Bool`: `Number()` on its own also reads
    // hex, binary, exponents and surrounding blanks, so `"0x10"` was `Some(16)`.
    case "Int":
      return `((_v) => (typeof _v === "string" && /^[+-]?[0-9]+$/.test(_v)) ? _s.Some(Number(_v)) : _s.None)(${a})`;
    case "Float":
      return `((_v) => { if (typeof _v !== "string" || !/^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$/.test(_v)) return _s.None; const _n = Number(_v); return Number.isFinite(_n) ? _s.Some(_n) : _s.None; })(${a})`;
    case "Time":
      // A `Time` is a millisecond number (stdlib.md §2.2.9), so parsing one has
      // to produce that number, or every later `diff` / `plus` / `format` reads
      // a string and produces `NaN`. The zone rule for a date-only string lives
      // with the formatter that has to agree with it.
      return `_s.parseTime(${a})`;
    case "Bool":
      // Converted, not wrapped: `Some("false")` unwraps to a non-empty string,
      // which every `if` reads as true.
      return `((_v) => _v === "true" ? _s.Some(true) : _v === "false" ? _s.Some(false) : _s.None)(${a})`;
    case "Text":
      return `((_v) => (typeof _v === "string" && _v.length > 0) ? _s.Some(_v) : _s.None)(${a})`;
    case "Bytes":
      return `((_v) => (typeof _v === "string" && _v.length > 0) ? _s.Some(_s.bytesFromText(_v)) : _s.None)(${a})`;
  }
}

/**
 * `T.parse(text)` → `Option(T)`, converted by the base `T` unaliases to rather
 * than by its name — so `type Cents = nominal Int` and the standard library's
 * `Duration` read a number, as `Int` does.
 *
 * The reading is then held to every refinement `T` carries, and one it fails is
 * `None`. An `Option(Cents)` never meets a slot-write guard, so without this
 * `Cents.parse("-5")` handed the program a `Cents` its own type refuses.
 *
 * `parseQualifier` is the answer the checker reports E0802 from (E0124 first,
 * for a constructor written without its arguments), so a qualifier
 * with no reading never reaches here from a checked program; the throw is for
 * `codegen()` called without `check()`, which would otherwise lower to a value
 * of the wrong kind.
 */
function parseJs(callee: string, args: Expr[], pos: Pos, ctx: EvalCtx): string {
  const a = requiredArg(callee, args, pos, ctx);
  const qualifier = callee.slice(0, callee.indexOf("."));
  const answer = parseQualifier(qualifier, ctx.gen);
  if (answer.kind !== "reading") {
    throw new Error(
      `${callee}() at ${pos.line}:${pos.col} names a type no text has a reading as — run \`check\` for the diagnostic`,
    );
  }
  const read = readingJs(answer.reading, a);
  const refine = refinementJs({ kind: "TypeRef", name: qualifier, pos }, ctx.gen);
  if (refine === undefined) return read;
  return `((_o) => (_o._tag === "Some" && !(${refine})(_o._0)) ? _s.None : _o)(${read})`;
}

export function jsOfExpr(e: Expr, ctx: EvalCtx): string {
  switch (e.kind) {
    case "Num":
      return String(e.value);
    case "Str":
      return JSON.stringify(e.value);
    case "Bool":
      return e.value ? "true" : "false";
    case "Unit":
      return "null";
    case "Ref": {
      if (ctx.localBinds.has(e.name)) return bindRef(ctx, e.name);
      if (e.name === "now") return `_s.now()`;
      // `route` is an auto-managed slot maintained by the runtime.
      if (e.name === "route") {
        return ctx.reducerScope
          ? `((_next["route"] !== undefined) ? _next["route"] : _live["route"])`
          : `_live["route"]`;
      }
      const isSlot = ctx.gen.slots.some((s) => s.name === e.name);
      if (isSlot) {
        const key = JSON.stringify(e.name);
        return ctx.reducerScope
          ? `((_next[${key}] !== undefined) ? _next[${key}] : _live[${key}])`
          : `_live[${key}]`;
      }
      return jsBinding(e.name);
    }
    case "BinOp": {
      const l = jsOfExpr(e.lhs, ctx);
      const r = jsOfExpr(e.rhs, ctx);
      if (e.op === "+") return `_s.add(${l}, ${r})`;
      if (e.op === "&") return `(${l} && ${r})`;
      if (e.op === "|") return `(${l} || ${r})`;
      if (e.op === "==") return `_s.eq(${l}, ${r})`;
      if (e.op === "!=") return `(!_s.eq(${l}, ${r}))`;
      return `(${l} ${e.op} ${r})`;
    }
    case "UnaryOp":
      return `(${e.op === "!" ? "!" : "-"}${jsOfExpr(e.rhs, ctx)})`;
    case "FieldAccess": {
      const baseJs = jsOfExpr(e.base, ctx);
      // ADR-002 (#23): when the checker has inferred that the receiver is a
      // record with this field, read the field — do NOT let a same-named method
      // shortcut shadow it. `accessKind` is only set when `check()` ran; absent,
      // we keep the historical name-based dispatch below (back-compat).
      if (e.accessKind === "field") return `(${baseJs})[${JSON.stringify(e.field)}]`;
      // For Option/Result values stored as {_tag,_0}, accessing common fields like
      // ".get" needs unwrapping. We special-case ".get" / ".is-some" / ".is-none" /
      // ".is-ok" / ".is-err".
      if (e.field === "get") return `_s.unwrap(${baseJs})`;
      if (e.field === "is-some") return `(_s.variantIs(${baseJs}, "Some"))`;
      if (e.field === "is-none") return `(_s.variantIs(${baseJs}, "None"))`;
      if (e.field === "is-ok") return `(_s.variantIs(${baseJs}, "Ok"))`;
      if (e.field === "is-err") return `(_s.variantIs(${baseJs}, "Err"))`;
      if (e.field === "keys") return `_s.mapKeys(${baseJs}${keyKindArg(e.keyKind)})`;
      if (e.field === "values") return `_s.mapValues(${baseJs})`;
      if (e.field === "entries") return `_s.mapEntries(${baseJs}${keyKindArg(e.keyKind)})`;
      if (e.field === "size") return `_s.mapSize(${baseJs})`;
      if (e.field === "to-ms" || e.field === "ms") return `(${baseJs})`;
      // .show on values (variants → _tag, numbers/strings → String)
      if (e.field === "show") return `_s.show(${baseJs})`;
      // .length on text/list/string
      if (e.field === "length") return `((${baseJs}) ?? "").length`;
      if (e.field === "is-empty")
        return `(((${baseJs}) ?? []).length === 0 || ((${baseJs}) ?? "") === "")`;
      // .lower / .upper on Text
      if (e.field === "lower") return `(String((${baseJs}) ?? "")).toLowerCase()`;
      if (e.field === "upper") return `(String((${baseJs}) ?? "")).toUpperCase()`;
      if (e.field === "trim") return `(String((${baseJs}) ?? "")).trim()`;
      // Zero-arg list / string method shorthands (callable without parens)
      if (e.field === "unique") return `[...new Set((${baseJs}) ?? [])]`;
      if (e.field === "reverse") return `[...((${baseJs}) ?? [])].reverse()`;
      if (e.field === "sort") return `_s.listSort(${baseJs})`;
      // Issue #7: argument-less spec stdlib methods in the parenthesis-free form
      // (docs/spec/stdlib.md §2.2.3 — the recommended shortcut). Kept in exact sync
      // with the MethodCall (paren) cases in methodCallJs + KNOWN_METHODS.
      if (e.field === "head") return `_s.listHead(${baseJs})`;
      if (e.field === "tail") return `_s.listTail(${baseJs})`;
      if (e.field === "last") return `_s.listLast(${baseJs})`;
      if (e.field === "to-list") return `_s.toList(${baseJs}${keyKindArg(e.keyKind)})`;
      if (e.field === "get-err") return `_s.getErr(${baseJs})`;
      if (e.field === "to-option") return `_s.toOption(${baseJs})`;
      if (e.field === "parse-int") return `_s.parseIntOpt(${baseJs})`;
      if (e.field === "parse-float") return `_s.parseFloatOpt(${baseJs})`;
      if (e.field === "abs") return `Math.abs(${baseJs})`;
      if (e.field === "neg") return `(-(${baseJs}))`;
      if (e.field === "floor") return `Math.floor(${baseJs})`;
      if (e.field === "ceil") return `Math.ceil(${baseJs})`;
      if (e.field === "round") return `Math.round(${baseJs})`;
      if (e.field === "sqrt") return `Math.sqrt(${baseJs})`;
      if (e.field === "log") return `Math.log(${baseJs})`;
      if (e.field === "exp") return `Math.exp(${baseJs})`;
      if (e.field === "to-float") return `(${baseJs})`;
      if (e.field === "to-int") return `Math.trunc(${baseJs})`;
      return `(${baseJs})[${JSON.stringify(e.field)}]`;
    }
    case "Index": {
      // Through the runtime, so a List index that names no element panics
      // here as it does on the left of `:=` (language.md §1.6.3).
      return `_s.index(${jsOfExpr(e.base, ctx)}, ${jsOfExpr(e.index, ctx)})`;
    }
    case "Call": {
      const cn = e.callee;
      // `run-reducer(name)` inside a property-test invariant (§8.3): apply the
      // named reducer to the trial's initial state (`_init` / `_event` are bound
      // in the generated trial fn). Chained `.run-reducer(...)` is in methodCallJs.
      if (cn === "run-reducer") {
        return `_s.runReducerStep(App, _init, ${JSON.stringify(reducerNameArg(e.args[0]))}, _event)`;
      }
      // Module calls like TodoId.fresh, now, etc.
      if (cn === "now") return `_s.now()`;
      if (/^[A-Z][A-Za-z0-9_]*\.fresh$/.test(cn)) return `_s.freshId()`;
      if (/^[A-Z][A-Za-z0-9_]*\.parse$/.test(cn)) return parseJs(cn, e.args, e.pos, ctx);
      if (/^[A-Z][A-Za-z0-9_]*\.show$/.test(cn)) {
        return `_s.show(${requiredArg(cn, e.args, e.pos, ctx)})`;
      }
      // Duration constructors → milliseconds (Time is stored as a raw ms number).
      if (cn === "Duration.ms") return `(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "Duration.s") return `((${requiredArg(cn, e.args, e.pos, ctx)}) * 1000)`;
      if (cn === "Duration.m" || cn === "Duration.min")
        return `((${requiredArg(cn, e.args, e.pos, ctx)}) * 60000)`;
      if (cn === "Duration.h") return `((${requiredArg(cn, e.args, e.pos, ctx)}) * 3600000)`;
      if (cn === "Duration.d" || cn === "Duration.days")
        return `((${requiredArg(cn, e.args, e.pos, ctx)}) * 86400000)`;
      // Bytes constructors (docs/spec/stdlib.md §2.1.1 / §2.2.10).
      // Bytes is represented as Uint8Array at runtime.
      if (cn === "Bytes.from-text")
        return `_s.bytesFromText(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "Bytes.from-base64")
        return `_s.bytesFromBase64(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "Bytes.from-bytes")
        return `_s.bytesFromBytes(${requiredArg(cn, e.args, e.pos, ctx)})`;
      // `EffectId.none` — empty-handle sentinel (spec stdlib §2.1.1.1). The
      // runtime treats falsy / unknown ids as silent no-ops, so the empty
      // string doubles as a valid slot-initial value AND a guaranteed-no-op
      // cancel target.
      if (cn === "EffectId.none") return `""`;
      // Decoder.* — codegen treats a decoder as a sentinel string, which the
      // HTTP handler reads as `decode ?? "json"` and branches on: `json` /
      // `text` / `none`, everything else falling through to text. Emitting no
      // sentinel therefore means json, not "no decoding" — which is what made
      // the paren-less form parse a body that was meant to be discarded.
      // The storage handler is a different matter: it never receives a decoder
      // at all and always `JSON.parse`s, so `decode` on a `storage.*` effect is
      // documented and dropped.
      if (cn === "Decoder.Json") return `"json"`;
      if (cn === "Decoder.Text") return `"text"`;
      if (cn === "Decoder.Bytes") return `"bytes"`;
      if (cn === "Decoder.None") return `"none"`;
      if (cn === "fmt") {
        // `fmt(template, ...args)` — stdlib.md §2.4.5. No guard: a fallback
        // answers a missing helper with a `Text` that reads like a formatted
        // one, which is the shape that let the substitution go missing (#340).
        const template = requiredArg(cn, e.args, e.pos, ctx);
        const rest = e.args.slice(1).map((a) => jsOfExpr(a, ctx));
        return `_s.fmt(${[template, ...rest].join(", ")})`;
      }
      // `panic(message)` — Kumiki's controlled stop-the-program signal
      // (docs/spec/stdlib.md §2.4.6). Lowers to the runtime helper that throws a
      // KumikiPanic, which the live dispatch / render boundary catches.
      if (cn === "panic") return `_s.panic(${requiredArg(cn, e.args, e.pos, ctx)})`;
      // `prefers-dark()` — reads `prefers-color-scheme: dark` (style.md §4.6.1).
      // Environment-reading like `now`, and used the same way: an `app.start`
      // reducer picks the initial theme from it.
      if (cn === "prefers-dark") return `_s.prefersDark()`;
      // `random()` — a Float in [0, 1). Non-deterministic like `now`, and
      // unrestricted for the same reason: a rule confining it to reducers would
      // be the only purity rule in the language that no other builtin has.
      // Through the runtime helper rather than inline `Math.random()`: the
      // helper is the seam the episode journal records at, and an inline draw
      // is invisible to it (#337, runtime.md §10.5.1).
      if (cn === "random") return "_s.random()";
      // `file-url(file)` — URL.createObjectURL equivalent (forms.md §5.10).
      // The runtime helper is None-safe so `file-url(avatar.get)` does not
      // throw before `is-some` guards inside `when(...)` short-circuit.
      if (cn === "file-url") return `_s.fileUrl(${requiredArg(cn, e.args, e.pos, ctx)})`;
      const args = e.args.map((a) => jsOfExpr(a, ctx)).join(", ");
      // Otherwise treat as user-defined fn
      return `${jsBinding(cn)}(${args})`;
    }
    case "MethodCall": {
      return methodCallJs(e.receiver, e.method, e.args, ctx, e.keyKind);
    }
    case "RecordLit": {
      const parts = e.fields.map((f) => `${JSON.stringify(f.name)}: ${jsOfExpr(f.value, ctx)}`);
      return `{ ${parts.join(", ")} }`;
    }
    case "ListLit":
      return `[${e.items.map((it) => jsOfExpr(it, ctx)).join(", ")}]`;
    // The same array a tuple pattern destructures — `tupleArm` guards with
    // `Array.isArray` and reads by index, so the two halves already agreed on
    // the shape before there was a way to write one.
    case "TupleLit":
      return `[${e.items.map((it) => jsOfExpr(it, ctx)).join(", ")}]`;
    case "MapLit": {
      const parts = e.entries.map((en) => {
        // A `<any-id>` map key (test expect, §8.2.2) lowers to the runtime's
        // wild-key sentinel so the matcher pairs it with the one generated entry.
        const keyJs =
          en.key.kind === "Wildcard" && en.key.wild === "any-id"
            ? "[_s.WILD_KEY]"
            : `[${jsOfExpr(en.key, ctx)}]`;
        return `${keyJs}: ${jsOfExpr(en.value, ctx)}`;
      });
      return `{ ${parts.join(", ")} }`;
    }
    case "Wildcard":
      // Value-position wildcard (`<any-id>` / `<slots.X>`) → a runtime sentinel
      // that `wcEqual` recognises during reducer-test comparison.
      return e.wild === "any-id"
        ? `_s.wild("any-id")`
        : `_s.wild("slot", ${JSON.stringify(e.slot)})`;
    case "EmitExpr":
      return emitExprJs(e, ctx);
    case "MatchExpr":
      return matchExprJs(e, ctx);
    case "IfExpr":
      return `((${jsOfExpr(e.cond, ctx)}) ? (${jsOfExpr(e.consequent, ctx)}) : (${jsOfExpr(e.alternate, ctx)}))`;
    case "LetIn": {
      // The value is generated against the enclosing scope and the body
      // against the new one, so `let x = x + 1 in x` reads the binding it
      // shadows rather than the one being declared.
      const inner = addBind(ctx, e.name);
      return `(() => { const ${bindRef(inner, e.name)} = ${jsOfExpr(e.value, ctx)}; return ${jsOfExpr(e.body, inner)}; })()`;
    }
    case "Variant":
      return variantJs(e.name, e.payload, ctx);
    case "TokenRef": {
      // Theme-token reference (spec/style.md §4.3): lowers to the unified
      // runtime resolver which walks the active theme and falls back to the
      // built-in defaults baked into mapColor/mapToken/mapSize.
      const pathJs = `[${e.path.map((p) => JSON.stringify(p)).join(", ")}]`;
      return `_s.token(${JSON.stringify(e.group)}, ${pathJs})`;
    }
  }
}

/**
 * Methods the code generator actually implements (the `methodCallJs` switch
 * cases below). This is the single source of truth for what `obj.method(...)`
 * calls are runnable; the typechecker uses it to flag unimplemented methods
 * (E0801) at `check` time instead of letting them throw or misbehave at runtime.
 * Keep this in exact sync with the `switch (method)` cases.
 */
/**
 * How many arguments a method's lowering reads. Every entry here dereferences
 * that many with `!`, so a call written with fewer crashes codegen — no file,
 * no line, no diagnostic. The typechecker reports the shortfall instead
 * (E0213); `check` and `build` then agree about the same program.
 *
 * Only the minimum is listed. `slice` takes one or two and spreads whatever it
 * is given, so it is absent — a count is only a contract where the lowering
 * treats it as one.
 */
export const METHOD_MIN_ARGS: ReadonlyMap<string, number> = new Map([
  ["add", 1],
  ["chunk", 1],
  ["clamp", 2],
  ["concat", 1],
  ["contains", 1],
  ["diff", 1],
  ["ends-with", 1],
  ["filter", 1],
  ["find", 1],
  ["flat-map", 1],
  ["fold", 2],
  ["format", 1],
  ["get", 1],
  // One shape takes a default, the other a key AND a default; the lowering
  // branches on the count, so one is the floor.
  ["get-or", 1],
  ["has", 1],
  ["insert", 2],
  ["intersect", 1],
  ["join", 1],
  ["map", 1],
  ["map-err", 1],
  ["max", 1],
  ["pow", 1],
  ["merge", 1],
  ["min", 1],
  ["minus", 1],
  ["or", 1],
  ["plus", 1],
  ["prepend", 1],
  ["push", 1],
  ["remove", 1],
  ["replace", 2],
  ["sort-by", 1],
  ["split", 1],
  ["starts-with", 1],
  ["toggle", 1],
  ["union", 1],
  ["update", 2],
  ["zip", 1],
]);

export const KNOWN_METHODS: ReadonlySet<string> = new Set([
  "filter",
  "map",
  "flat-map",
  "size",
  "keys",
  "has",
  "toggle",
  "get",
  "get-or",
  "remove",
  "insert",
  "sort-by",
  "fold",
  "show",
  "is-some",
  "is-none",
  "is-empty",
  "to-ms",
  "copy",
  "find",
  "push",
  "unique",
  "reverse",
  "join",
  "split",
  "contains",
  "starts-with",
  "ends-with",
  "length",
  "slice",
  "trim",
  "format",
  "plus",
  "minus",
  "diff",
  // Issue #5: docs/spec/stdlib.md §2.2 methods that were missing here and therefore
  // wrongly rejected with E0801. All take ≥1 argument, so they always parse as
  // MethodCall (never the parenthesis-free FieldAccess form).
  "concat", // List(T).concat(other)
  "prepend", // List(T).prepend(x)
  "chunk", // List(T).chunk(n)
  "zip", // List(T).zip(other)
  "merge", // Map(K,V).merge(other)
  "update", // Map(K,V).update(k, expr)  — $1 is the current value inside expr
  "add", // Set(T).add(x)
  "union", // Set(T).union(other)
  "intersect", // Set(T).intersect(other)
  "or", // Option(T).or(other) / Result(T,E).or(other)
  "map-err", // Result(T,E).map-err(expr)
  "replace", // Text.replace(from, to)
  "min", // Int/Float.min(b)
  "max", // Int/Float.max(b)
  "clamp", // Int/Float.clamp(lo, hi)
  // Issue #7: docs/spec/stdlib.md §2.2 argument-less methods. These also parse as the
  // parenthesis-free FieldAccess form (handled in jsOfExpr); listing them here
  // makes the `recv.method()` shape compile instead of tripping E0801.
  "head", // List(T).head → Option(T)
  "tail", // List(T).tail → List(T)
  "last", // List(T).last → Option(T)
  "to-list", // Set(T).to-list / Option(T).to-list → List(T)
  "get-err", // Result(T,E).get-err → E (panics if Ok)
  "to-option", // Result(T,E).to-option → Option(T)
  "parse-int", // Text.parse-int → Option(Int)
  "parse-float", // Text.parse-float → Option(Float)
  "abs", // Int/Float.abs
  "neg", // Int/Float.neg
  // stdlib.md §2.2.7. Documented as a `math.*` namespace the parser could never
  // read — a lowercase qualifier is not one — so every call reported E0103.
  "floor", // Float.floor → Int
  "ceil", // Float.ceil → Int
  "round", // Float.round → Int (ties go up, toward +∞: (-2.5).round is -2)
  "sqrt", // Int/Float.sqrt → Float
  "log", // Int/Float.log → Float (natural logarithm)
  "exp", // Int/Float.exp → Float
  "pow", // Int/Float.pow(n)
  "to-float", // Int.to-float → Float
  "to-int", // Float.to-int → Int (truncated)
  // Issue #92: stdlib methods that also have FieldAccess shortcuts (see
  // FIELD_ACCESS_SHORTCUTS / jsOfExpr). Both shapes lower to the same `_s.*`
  // helper via the matching cases in methodCallJs — keeps FIELD_ACCESS_SHORTCUTS
  // ⊆ KNOWN_METHODS and stops the paren form from falling through to native JS.
  "is-ok", // Result(T,E).is-ok → Bool
  "is-err", // Result(T,E).is-err → Bool
  "values", // Map(K,V).values → List(V)
  "entries", // Map(K,V).entries → List([K,V])
  "lower", // Text.lower → Text
  "upper", // Text.upper → Text
  "sort", // List(T).sort → List(T)
  "ms", // Time/Duration.ms → Int
]);

/**
 * The method names codegen lowers in the parenthesis-free `recv.m` (FieldAccess)
 * form — kept in sync with the `if (e.field === …)` chain in jsOfExpr's
 * FieldAccess case. A subset of KNOWN_METHODS (enforced by a test): every
 * no-paren shortcut must also accept the `recv.m()` shape.
 */
export const FIELD_ACCESS_SHORTCUTS: ReadonlySet<string> = new Set([
  "get",
  "is-some",
  "is-none",
  "is-ok",
  "is-err",
  "keys",
  "values",
  "entries",
  "size",
  "to-ms",
  "ms",
  "show",
  "length",
  "is-empty",
  "lower",
  "upper",
  "trim",
  "unique",
  "reverse",
  "sort",
  "head",
  "tail",
  "last",
  "to-list",
  "get-err",
  "to-option",
  "parse-int",
  "parse-float",
  "abs",
  "neg",
  "to-float",
  "to-int",
  "floor",
  "ceil",
  "round",
  "sqrt",
  "log",
  "exp",
]);

/**
 * The members that only a number has (docs/spec/stdlib.md §2.2.7).
 *
 * `KNOWN_MEMBERS` is flat — it answers "does the runtime understand this name
 * on some receiver", not "on this one" — so without this set every arithmetic
 * name was a member of `Text`, of a `List`, of anything the checker recognised.
 * `someText.round` passed and lowered to `Math.round("hello")`: `NaN` into
 * whatever it was assigned to, with nothing reported anywhere.
 */
export const NUMERIC_MEMBERS: ReadonlySet<string> = new Set([
  "abs",
  "neg",
  "min",
  "max",
  "clamp",
  "floor",
  "ceil",
  "round",
  "sqrt",
  "log",
  "exp",
  "pow",
  "to-float",
  "to-int",
]);

/**
 * Every member name the runtime understands on a stdlib receiver — the union of
 * the method-call methods and the no-paren shortcuts. Used by the type checker
 * (ADR-002) to decide whether `recv.m` on a *known* receiver type is a real
 * member (→ shortcut) or an unknown one (→ E0108). Flat, not per-type.
 */
export const KNOWN_MEMBERS: ReadonlySet<string> = new Set([
  ...KNOWN_METHODS,
  ...FIELD_ACCESS_SHORTCUTS,
]);

/**
 * The trailing argument a key reader (`keys` / `entries` / `to-list`, and a
 * Map's `filter`) is given
 * so the runtime restores the keys it reads to their declared kind — nothing
 * when the checker recorded none, which leaves the string a key is stored as.
 */
function keyKindArg(kind: KeyKind | undefined): string {
  return kind ? `, ${JSON.stringify(kind)}` : "";
}

export function methodCallJs(
  recv: Expr,
  method: string,
  args: Expr[],
  ctx: EvalCtx,
  keyKind?: KeyKind,
): string {
  // Chained `recv.run-reducer(name)` in a property-test invariant (§8.3): apply
  // the reducer to the receiver state. `_event` is bound in the generated trial.
  if (method === "run-reducer") {
    return `_s.runReducerStep(App, ${jsOfExpr(recv, ctx)}, ${JSON.stringify(reducerNameArg(args[0]))}, _event)`;
  }
  // Build inner ctx with $1, $2 bound for predicate expression fragments.
  const inner = makeEvalCtx(ctx.gen, ctx.localBinds);
  const p1 = declareBind(inner, "$1");
  const p2 = declareBind(inner, "$2");

  const recvJs = jsOfExpr(recv, ctx);
  // For list ops, the element may be a plain T or a [K, V] tuple (from .entries).
  // Generate a lambda that binds `$1` and `$2` accordingly: for a 2-tuple we
  // bind ($1=k, $2=v); for any other element we bind $1=elem, $2=undefined.
  const argFnList = (a: Expr): string =>
    `((__x, __y) => { const _isPair = (Array.isArray(__x) && __x.length === 2); const ${p1} = _isPair ? __x[0] : __x; const ${p2} = _isPair ? __x[1] : (__y !== undefined ? __y : __x); return ${jsOfExpr(a, inner)}; })`;
  const argRaw = (a: Expr): string => jsOfExpr(a, ctx);

  switch (method) {
    case "filter":
      // The receiver may be a List (incl. .entries → [k,v] tuples) or a Map.
      // Dispatch at runtime; the lambda destructures tuples and also accepts
      // the (k, v) calling convention used by mapFilter.
      // A Map's predicate is handed each key, restored like any key reader's.
      return `_s.filter(${recvJs}, ${argFnList(args[0]!)}${keyKindArg(keyKind)})`;
    case "map":
      // Polymorphic: List(T).map (over elements, incl. .entries [k,v] tuples)
      // or Option(T).map (over Some). Runtime distinguishes by variant `_tag`.
      return `_s.mapOver(${recvJs}, ${argFnList(args[0]!)})`;
    case "flat-map":
      // Option(T).flat-map(f): Some(v) -> f(v) (which itself returns Option), None -> None.
      return `_s.flatMapOption(${recvJs}, ((${p1}) => ${jsOfExpr(args[0]!, inner)}))`;
    case "size":
      return `_s.mapSize(${recvJs})`;
    case "keys":
      return `_s.mapKeys(${recvJs}${keyKindArg(keyKind)})`;
    case "has":
      return `_s.setHas(${recvJs}, ${argRaw(args[0]!)})`;
    case "toggle":
      return `_s.setToggle(${recvJs}, ${argRaw(args[0]!)})`;
    case "get":
      // Spec: Map(K,V).get returns Option(V). Wrap the raw lookup result.
      return `((_v) => _v === undefined ? _s.None : _s.Some(_v))(_s.mapGet(${recvJs}, ${argRaw(args[0]!)}))`;
    case "get-or":
      // Two shapes:
      //   Option(T).get-or(default)    → returns T (unwrap or default)
      //   Map(K,V).get-or(key, default) → returns V (lookup or default)
      // The count selects the shape, and the helpers dispatch on the value at
      // runtime, so no static type is needed here. `checkGetOrArity` is what
      // makes that safe: a count that does not fit a receiver the checker can
      // decide is reported, and a count past both readings is reported on any
      // receiver — which matters because the second branch below reads exactly
      // two arguments and would otherwise drop the rest without a word.
      if (args.length === 1) {
        return `_s.getOr(${recvJs}, ${argRaw(args[0]!)})`;
      }
      return `_s.mapGetOr(${recvJs}, ${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "remove":
      return `_s.mapRemove(${recvJs}, ${argRaw(args[0]!)})`;
    case "insert":
      return `_s.mapInsert(${recvJs}, ${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "sort-by":
      return `_s.listSortBy(${recvJs}, ${argFnList(args[0]!)})`;
    case "fold":
      // List(T).fold(init, expr) — expr binds $1=acc, $2=elem (distinct from the
      // $1=elem/$2=value convention of filter/map), so emit its own lambda.
      return `_s.listFold(${recvJs}, ${argRaw(args[0]!)}, (${p1}, ${p2}) => ${jsOfExpr(args[1]!, inner)})`;
    case "show":
      return `_s.show(${recvJs})`;
    case "is-some":
      return `_s.variantIs(${recvJs}, "Some")`;
    case "is-none":
      return `_s.variantIs(${recvJs}, "None")`;
    case "is-empty":
      return `(_s.mapSize(${recvJs}) === 0)`;
    case "to-ms":
      return `(${recvJs})`;
    case "copy":
      // record.copy(field=value, ...) → record with patches
      // args expected to be a single RecordLit with the patch.
      if (args[0] && args[0].kind === "RecordLit") {
        return `_s.recordCopy(${recvJs}, ${jsOfExpr(args[0], ctx)})`;
      }
      return `_s.recordCopy(${recvJs}, {})`;
    case "find":
      // Spec: List(T).find returns Option(T), like `head` and `last`. The raw
      // array `find` answers `undefined` on no match, which reads as neither
      // `Some` nor `None`.
      return `_s.listFind(${recvJs}, ${argFnList(args[0]!)})`;
    case "push":
      return `[...(${recvJs} ?? []), ${argRaw(args[0]!)}]`;
    case "unique":
      return `[...new Set((${recvJs} ?? []))]`;
    case "reverse":
      return `[...(${recvJs} ?? [])].reverse()`;
    case "join":
      return `((${recvJs}) ?? []).join(${argRaw(args[0]!)})`;
    case "split":
      return `((${recvJs}) ?? "").split(${argRaw(args[0]!)})`;
    case "contains":
      return `(typeof (${recvJs}) === "string" ? ((${recvJs}) ?? "").includes(${argRaw(args[0]!)}) : ((${recvJs}) ?? []).includes(${argRaw(args[0]!)}))`;
    case "starts-with":
      return `((${recvJs}) ?? "").startsWith(${argRaw(args[0]!)})`;
    case "ends-with":
      return `((${recvJs}) ?? "").endsWith(${argRaw(args[0]!)})`;
    case "length":
      return `((${recvJs}) || "").length`;
    case "slice":
      return `((${recvJs}) || "").slice(${args.map(argRaw).join(", ")})`;
    case "trim":
      return `((${recvJs}) || "").trim()`;
    case "format":
      // Time.format(pattern) — the pattern is the caller's, not ours. This
      // used to render the ISO date whatever was asked for, so every
      // `"yyyy-MM-dd HH:mm"` in an app lost its time and shifted its day.
      return `_s.formatTime(${recvJs}, ${argRaw(args[0]!)})`;
    case "plus":
      // Time.plus(durationMs) / Duration.plus — both stored as raw ms numbers.
      return `((${recvJs}) + (${argRaw(args[0]!)}))`;
    case "minus":
      return `((${recvJs}) - (${argRaw(args[0]!)}))`;
    case "diff":
      // Polymorphic: Time/Duration → numeric magnitude; Set(T) → set difference.
      return `_s.diff(${recvJs}, ${argRaw(args[0]!)})`;
    // ----- Issue #5: previously-missing stdlib methods -----
    case "concat":
      // List(T).concat(other)
      return `[...((${recvJs}) ?? []), ...((${argRaw(args[0]!)}) ?? [])]`;
    case "prepend":
      // List(T).prepend(x)
      return `[${argRaw(args[0]!)}, ...((${recvJs}) ?? [])]`;
    case "chunk":
      // List(T).chunk(n) → List(List(T))
      return `_s.listChunk(${recvJs}, ${argRaw(args[0]!)})`;
    case "zip":
      // List(T).zip(other) → List(Tuple(T, U))
      return `_s.listZip(${recvJs}, ${argRaw(args[0]!)})`;
    case "merge":
      // Map(K,V).merge(other) — right side wins on key conflicts. Wrapped in
      // parens so the object literal is safe in arrow-body position.
      return `({ ...((${recvJs}) ?? {}), ...((${argRaw(args[0]!)}) ?? {}) })`;
    case "update":
      // Map(K,V).update(k, expr) — within expr, $1 is the current value.
      return `_s.mapUpdate(${recvJs}, ${argRaw(args[0]!)}, ((${p1}) => (${jsOfExpr(args[1]!, inner)})))`;
    case "add":
      // Set(T).add(x)
      return `_s.setAdd(${recvJs}, ${argRaw(args[0]!)})`;
    case "union":
      // Set(T).union(other)
      return `_s.setUnion(${recvJs}, ${argRaw(args[0]!)})`;
    case "intersect":
      // Set(T).intersect(other)
      return `_s.setIntersect(${recvJs}, ${argRaw(args[0]!)})`;
    case "or":
      // Option(T).or(other) / Result(T,E).or(other)
      return `_s.or(${recvJs}, ${argRaw(args[0]!)})`;
    case "map-err":
      // Result(T,E).map-err(expr) — within expr, $1 is the current Err payload.
      return `_s.mapErr(${recvJs}, ((${p1}) => (${jsOfExpr(args[0]!, inner)})))`;
    case "replace":
      // Text.replace(from, to) — replaces every occurrence.
      return `String((${recvJs}) ?? "").replaceAll(${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "min":
      return `Math.min((${recvJs}), (${argRaw(args[0]!)}))`;
    case "max":
      return `Math.max((${recvJs}), (${argRaw(args[0]!)}))`;
    case "clamp":
      // Int/Float.clamp(lo, hi)
      return `Math.min(Math.max((${recvJs}), (${argRaw(args[0]!)})), (${argRaw(args[1]!)}))`;
    // ----- Issue #92: paren-form stdlib methods kept in sync with the
    // FieldAccess (no-paren) cases in jsOfExpr. Without these the calls fall
    // through to the generic `(recv).method(...)` fallback and delegate to
    // native JS — silent failure for `.is-ok()` / `.values()` / `.lower()` etc. -----
    case "is-ok":
      return `(_s.variantIs(${recvJs}, "Ok"))`;
    case "is-err":
      return `(_s.variantIs(${recvJs}, "Err"))`;
    case "values":
      return `_s.mapValues(${recvJs})`;
    case "entries":
      return `_s.mapEntries(${recvJs}${keyKindArg(keyKind)})`;
    case "lower":
      return `(String((${recvJs}) ?? "")).toLowerCase()`;
    case "upper":
      return `(String((${recvJs}) ?? "")).toUpperCase()`;
    case "sort":
      return `_s.listSort(${recvJs})`;
    case "ms":
      return `(${recvJs})`;
    // ----- Issue #7: argument-less stdlib methods (parenthesized form). Kept in
    // sync with the FieldAccess (no-paren) cases in jsOfExpr + KNOWN_METHODS. -----
    case "head":
      return `_s.listHead(${recvJs})`;
    case "tail":
      return `_s.listTail(${recvJs})`;
    case "last":
      return `_s.listLast(${recvJs})`;
    case "to-list":
      return `_s.toList(${recvJs}${keyKindArg(keyKind)})`;
    case "get-err":
      return `_s.getErr(${recvJs})`;
    case "to-option":
      return `_s.toOption(${recvJs})`;
    case "parse-int":
      return `_s.parseIntOpt(${recvJs})`;
    case "parse-float":
      return `_s.parseFloatOpt(${recvJs})`;
    case "abs":
      return `Math.abs(${recvJs})`;
    case "floor":
      return `Math.floor(${recvJs})`;
    case "ceil":
      return `Math.ceil(${recvJs})`;
    case "round":
      return `Math.round(${recvJs})`;
    case "sqrt":
      return `Math.sqrt(${recvJs})`;
    case "log":
      return `Math.log(${recvJs})`;
    case "exp":
      return `Math.exp(${recvJs})`;
    case "pow":
      return `((${recvJs}) ** (${argRaw(args[0]!)}))`;
    case "neg":
      return `(-(${recvJs}))`;
    case "to-float":
      return `(${recvJs})`;
    case "to-int":
      return `Math.trunc(${recvJs})`;
    default:
      // generic fallback: receiver.method(...args). A property position, so the
      // name must stay exactly what the runtime defines — jsProperty, not jsBinding.
      return `(${recvJs}).${jsProperty(method)}(${args.map(argRaw).join(", ")})`;
  }
}

export function variantJs(name: string, payload: Expr[], ctx: EvalCtx): string {
  // Treat capital-letter bare ident as a variant tag (already in payload form).
  if (payload.length === 0) {
    if (name === "None") return `_s.None`;
    return `({ _tag: ${JSON.stringify(name)} })`;
  }
  if (name === "Some") return `_s.Some(${jsOfExpr(payload[0]!, ctx)})`;
  if (name === "Ok") return `_s.Ok(${jsOfExpr(payload[0]!, ctx)})`;
  if (name === "Err") return `_s.Err(${jsOfExpr(payload[0]!, ctx)})`;
  return `_s.variant(${JSON.stringify(name)}, ${payload.map((p) => jsOfExpr(p, ctx)).join(", ")})`;
}

/**
 * `emit X(args)` used as an expression (spec http.md §6.4, stdlib §2.1.1.1):
 * queue the emit exactly as the statement form does, then yield the dispatched
 * effect's `EffectId`, `"<effect>:" + key`.
 */
export function emitExprJs(e: Expr & { kind: "EmitExpr" }, ctx: EvalCtx): string {
  const { stmts, idJs } = reducerEmitJs(e.effect, e.args, ctx);
  return `((() => { ${stmts} return ${idJs}; })())`;
}

/**
 * One `emit` in a reducer body, statement or expression: the statements that
 * push its record onto `_emits`, and the `EffectId` that names it.
 *
 * The key is `"_"` unless the effect has `policy=latest-per-key(<key>)`. Then
 * it is evaluated here, once, where the emit runs (http.md §6.4): the record
 * carries it to the dispatcher, which runs the request under it, and the id is
 * built from the same value — so `emit cancel(id)` names the request in flight
 * even when the body writes the key slot after emitting. Each argument is
 * bound once (`__a0`, `__a1`, …) for the same reason: `now()` or `T.fresh()`
 * evaluated twice would give the record and the key two different inputs.
 *
 * The key reads slots in reducer scope unconditionally rather than from
 * `ctx.reducerScope`. `_emits`, which this pushes to, is declared beside
 * `_next` in the reducer body (`emit-reducer.ts`), so `_next` is in scope
 * wherever this code runs — and a lowering on the way here that rebuilt the
 * `EvalCtx` without the flag would otherwise make the key read `_live` and miss
 * the body's own writes.
 */
export function reducerEmitJs(
  effect: string,
  args: Expr[],
  ctx: EvalCtx,
): { stmts: string; idJs: string } {
  const effectJson = JSON.stringify(effect);
  const policy = ctx.gen.effects.find((d) => d.name === effect)?.policy;
  if (policy?.kind !== "PolLatestKey") {
    const argsJs = args.map((a) => jsOfExpr(a, ctx)).join(", ");
    return {
      stmts: `_emits.push({ effect: ${effectJson}, args: [${argsJs}] });`,
      idJs: JSON.stringify(`${effect}:_`),
    };
  }
  const argBinds = args.map((a, i) => `const __a${i} = ${jsOfExpr(a, ctx)};`).join(" ");
  const argRefs = args.map((_, i) => `__a${i}`).join(", ");
  const inputRef = args[0] ? "__a0" : "null";
  const keyJs = `${policyKeyOfJs(policy.key, ctx.gen, true)}(${inputRef})`;
  return {
    stmts: `${argBinds} const __k = ${keyJs}; _emits.push({ effect: ${effectJson}, args: [${argRefs}], key: __k });`,
    idJs: `${JSON.stringify(`${effect}:`)} + __k`,
  };
}

/**
 * A `policy=latest-per-key(<key>)` key as a function of the effect's input,
 * answering the key as text. `reducerScope` says whether its slot reads may
 * name `_next`: true only for code placed inside a reducer body, where that
 * binding exists. The effect table's `keyOf` (`policyJs`) is built inside
 * `createApp()`, outside every reducer body, so it passes false.
 */
export function policyKeyOfJs(key: Expr, gen: GenCtx, reducerScope: boolean): string {
  const keyCtx = makeEvalCtx(gen, ["$1"], reducerScope);
  return `((${bindRef(keyCtx, "$1")}) => String(${jsOfExpr(key, keyCtx)}))`;
}

export function matchExprJs(e: Expr & { kind: "MatchExpr" }, ctx: EvalCtx): string {
  const sc = jsOfExpr(e.scrutinee, ctx);
  // Generate an IIFE that destructures the scrutinee and matches each arm.
  const armsJs = e.arms.map((arm) => matchArmJs(arm.pattern, arm.body, ctx, "_v")).join(" else ");
  return `((_v) => { ${armsJs} else { return undefined; } })(${sc})`;
}

function matchArmJs(p: Pattern, body: Expr, ctx: EvalCtx, scVar: string): string {
  if (p.kind === "PWildcard") {
    return `if (true) { return ${jsOfExpr(body, ctx)}; }`;
  }
  if (p.kind === "PBind") {
    const inner = addBind(ctx, p.name);
    return `if (true) { const ${bindRef(inner, p.name)} = ${scVar}; return ${jsOfExpr(body, inner)}; }`;
  }
  if (p.kind === "PTuple") {
    const { guard, binds, inner } = tupleArm(p, ctx, scVar, false);
    return `if (${guard}) { ${binds} return ${jsOfExpr(body, inner)}; }`;
  }
  // PVariant
  const tag = p.name;
  const inner = makeEvalCtx(ctx.gen, ctx.localBinds);
  const bindAssigns: string[] = [];
  for (let i = 0; i < p.binds.length; i++) {
    const name = p.binds[i]!;
    if (name === "_") continue;
    bindAssigns.push(`const ${declareBind(inner, name)} = (${scVar})[${JSON.stringify(`_${i}`)}];`);
  }
  return `if (_s.variantIs(${scVar}, ${JSON.stringify(tag)})) { ${bindAssigns.join(" ")} return ${jsOfExpr(body, inner)}; }`;
}

// Lower a tuple pattern into: a runtime guard (Array.isArray + length check + any
// nested element guards) and a series of `const … = scVar[i]…;` bindings.
// Nested PTuple / PVariant inside the tuple are recursively unrolled by walking
// the indexed access path. `inheritReducerScope` carries the caller's
// reducer-scope flag into the arm; with it off, a slot read in the arm lowers to
// `_live[...]`. A `match` statement passes true. TileMatch passes false because
// a tile renders outside every reducer body. `matchExpr` passes false too, and
// so drops the flag inside a reducer body as well — as its binding and variant
// arms do by rebuilding the context — which is a known gap, not a rule.
export function tupleArm(
  p: Pattern & { kind: "PTuple" },
  ctx: EvalCtx,
  scVar: string,
  inheritReducerScope: boolean,
): { guard: string; binds: string; inner: EvalCtx } {
  const inner = makeEvalCtx(
    ctx.gen,
    ctx.localBinds,
    inheritReducerScope ? ctx.reducerScope : undefined,
  );
  const guards: string[] = [`Array.isArray(${scVar})`, `(${scVar}).length === ${p.items.length}`];
  const binds: string[] = [];
  for (let i = 0; i < p.items.length; i++) {
    walkPatternForTupleArm(p.items[i]!, `(${scVar})[${i}]`, inner, guards, binds);
  }
  return { guard: guards.join(" && "), binds: binds.join(" "), inner };
}

export function walkPatternForTupleArm(
  p: Pattern,
  accessor: string,
  inner: EvalCtx,
  guards: string[],
  binds: string[],
): void {
  switch (p.kind) {
    case "PWildcard":
      return;
    case "PBind":
      binds.push(`const ${declareBind(inner, p.name)} = ${accessor};`);
      return;
    case "PVariant":
      guards.push(`_s.variantIs(${accessor}, ${JSON.stringify(p.name)})`);
      for (let i = 0; i < p.binds.length; i++) {
        const name = p.binds[i]!;
        if (name === "_") continue;
        binds.push(
          `const ${declareBind(inner, name)} = (${accessor})[${JSON.stringify(`_${i}`)}];`,
        );
      }
      return;
    case "PTuple":
      guards.push(`Array.isArray(${accessor})`, `(${accessor}).length === ${p.items.length}`);
      for (let i = 0; i < p.items.length; i++) {
        walkPatternForTupleArm(p.items[i]!, `(${accessor})[${i}]`, inner, guards, binds);
      }
      return;
    default: {
      const _exhaustive: never = p;
      throw new Error(`unreachable pattern kind: ${(_exhaustive as Pattern).kind}`);
    }
  }
}

import type { Expr, FragmentShape, KeyKind, Pattern, Pos, TypeExpr } from "../ast.ts";
import { type ParseReading, parseQualifier } from "../parse-reading.ts";
import { PRIM_TYPES } from "../parser.ts";
import {
  addBind,
  bindRef,
  childCtx,
  declareBind,
  type EvalCtx,
  fieldKey,
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

function decodedType(e: Expr | undefined): TypeExpr | undefined {
  if (e?.kind === "Variant") {
    if (e.payload.length === 0) {
      return PRIM_TYPES.has(e.name)
        ? { kind: "TypePrim", name: e.name as "Text", pos: e.pos }
        : { kind: "TypeRef", name: e.name, pos: e.pos };
    }
    const args = e.payload.map(decodedType);
    if (!args.every((a): a is TypeExpr => a !== undefined)) return undefined;
    return { kind: "TypeApp", name: e.name, args, pos: e.pos };
  }
  if (e?.kind === "RecordLit") {
    const fields = e.fields.map((f) => ({ name: f.name, type: decodedType(f.value), pos: f.pos }));
    if (!fields.every((f): f is { name: string; type: TypeExpr; pos: Pos } => !!f.type)) {
      return undefined;
    }
    return { kind: "TypeRecord", fields, pos: e.pos };
  }
  return undefined;
}

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
export function readingJs(reading: ParseReading, a: string): string {
  switch (reading) {
    case "Int":
      return `((_v) => (typeof _v === "string" && /^[+-]?[0-9]+$/.test(_v)) ? _s.Some(Number(_v)) : _s.None)(${a})`;
    case "Float":
      return `((_v) => { if (typeof _v !== "string" || !/^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$/.test(_v)) return _s.None; const _n = Number(_v); return Number.isFinite(_n) ? _s.Some(_n) : _s.None; })(${a})`;
    case "Time":
      return `_s.parseTime(${a})`;
    case "Bool":
      return `((_v) => _v === "true" ? _s.Some(true) : _v === "false" ? _s.Some(false) : _s.None)(${a})`;
    case "Text":
      return `((_v) => (typeof _v === "string" && _v.length > 0) ? _s.Some(_v) : _s.None)(${a})`;
    case "Bytes":
      return `((_v) => (typeof _v === "string" && _v.length > 0) ? _s.Some(_s.bytesFromText(_v)) : _s.None)(${a})`;
  }
}

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
      if (e.name === "route" || ctx.gen.slots.some((s) => s.name === e.name)) {
        return slotReadJs(e.name, ctx.reducerScope);
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
      if (e.accessKind === "field") return `(${baseJs})[${fieldKey(e.field)}]`;
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
      if (e.field === "show") return `_s.show(${baseJs})`;
      if (e.field === "length") return `((${baseJs}) ?? "").length`;
      if (e.field === "is-empty") return `_s.isEmpty(${baseJs})`;
      if (e.field === "lower") return `(String((${baseJs}) ?? "")).toLowerCase()`;
      if (e.field === "upper") return `(String((${baseJs}) ?? "")).toUpperCase()`;
      if (e.field === "trim") return `(String((${baseJs}) ?? "")).trim()`;
      if (e.field === "unique") return `_s.listUnique(${baseJs})`;
      if (e.field === "reverse") return `[...((${baseJs}) ?? [])].reverse()`;
      if (e.field === "sort") return `_s.listSort(${baseJs})`;
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
      return `(${baseJs})[${fieldKey(e.field)}]`;
    }
    case "Index": {
      return `_s.index(${jsOfExpr(e.base, ctx)}, ${jsOfExpr(e.index, ctx)})`;
    }
    case "Call": {
      const cn = e.callee;
      if (cn === "run-reducer") {
        return `_s.runReducerStep(App, _init, ${JSON.stringify(reducerNameArg(e.args[0]))}, _event)`;
      }
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
      if (cn === "Bytes.from-text")
        return `_s.bytesFromText(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "Bytes.from-base64")
        return `_s.bytesFromBase64(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "Bytes.from-bytes")
        return `_s.bytesFromBytes(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "EffectId.none") return `""`;
      if (cn === "Decoder.Json") {
        const t = decodedType(e.args[0]);
        return (t && ctx.gen.refinements.explainerOf(t)) ?? `"json"`;
      }
      if (cn === "Decoder.Text") return `"text"`;
      if (cn === "Decoder.Bytes") return `"bytes"`;
      if (cn === "Decoder.None") return `"none"`;
      if (cn === "fmt") {
        const template = requiredArg(cn, e.args, e.pos, ctx);
        const rest = e.args.slice(1).map((a) => jsOfExpr(a, ctx));
        return `_s.fmt(${[template, ...rest].join(", ")})`;
      }
      if (cn === "panic") return `_s.panic(${requiredArg(cn, e.args, e.pos, ctx)})`;
      if (cn === "prefers-dark") return `_s.prefersDark()`;
      if (cn === "random") return "_s.random()";
      if (cn === "file-url") return `_s.fileUrl(${requiredArg(cn, e.args, e.pos, ctx)})`;
      const args = e.args.map((a) => jsOfExpr(a, ctx)).join(", ");
      return `${jsBinding(cn)}(${args})`;
    }
    case "MethodCall": {
      return methodCallJs(e.receiver, e.method, e.args, ctx, e.keyKind, e.fragmentShape);
    }
    case "RecordLit": {
      const parts = e.fields.map((f) => `${fieldKey(f.name)}: ${jsOfExpr(f.value, ctx)}`);
      return `{ ${parts.join(", ")} }`;
    }
    case "ListLit": {
      if (!e.asSet) return `[${e.items.map((it) => jsOfExpr(it, ctx)).join(", ")}]`;
      const members = e.items.filter((it) => it.kind !== "Wildcard");
      const set = `_s.setOf([${members.map((it) => jsOfExpr(it, ctx)).join(", ")}])`;
      const anyIds = e.items.filter((it) => it.kind === "Wildcard" && it.wild === "any-id").length;
      const slotKeys = e.items.flatMap((it) =>
        it.kind === "Wildcard" && it.wild === "slot" ? [`[${jsOfExpr(it, ctx)}, true]`] : [],
      );
      const extra = [
        ...(anyIds === 0 ? [] : [`[_s.WILD_MEMBERS]: ${anyIds}`]),
        ...(slotKeys.length === 0 ? [] : [`[_s.WILD_SLOT_KEYS]: [${slotKeys.join(", ")}]`]),
      ];
      return extra.length === 0 ? set : `{ ...${set}, ${extra.join(", ")} }`;
    }
    case "TupleLit":
      return `[${e.items.map((it) => jsOfExpr(it, ctx)).join(", ")}]`;
    case "MapLit": {
      const slotKeys: string[] = [];
      const parts = e.entries.flatMap((en) => {
        const value = jsOfExpr(en.value, ctx);
        if (en.key.kind === "Wildcard" && en.key.wild === "slot") {
          slotKeys.push(`[${jsOfExpr(en.key, ctx)}, ${value}]`);
          return [];
        }
        const keyJs =
          en.key.kind === "Wildcard" ? "[_s.WILD_KEY]" : `[_s.entryKey(${jsOfExpr(en.key, ctx)})]`;
        return [`${keyJs}: ${value}`];
      });
      if (slotKeys.length > 0) parts.push(`[_s.WILD_SLOT_KEYS]: [${slotKeys.join(", ")}]`);
      return `{ ${parts.join(", ")} }`;
    }
    case "Wildcard":
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
      const inner = addBind(ctx, e.name);
      return `(() => { const ${bindRef(inner, e.name)} = ${jsOfExpr(e.value, ctx)}; return ${jsOfExpr(e.body, inner)}; })()`;
    }
    case "Variant":
      return variantJs(e.name, e.payload, ctx);
    case "TokenRef": {
      const pathJs = `[${e.path.map((p) => JSON.stringify(p)).join(", ")}]`;
      return `_s.token(${JSON.stringify(e.group)}, ${pathJs})`;
    }
  }
}

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

export const FRAGMENT_ARGUMENTS: ReadonlyMap<
  string,
  { index: number; binds: 1 | 2; second?: "element" | "pair-value" }
> = new Map([
  ["filter", { index: 0, binds: 2, second: "pair-value" }],
  ["map", { index: 0, binds: 2, second: "pair-value" }],
  ["find", { index: 0, binds: 2, second: "pair-value" }],
  ["sort-by", { index: 0, binds: 2, second: "pair-value" }],
  ["fold", { index: 1, binds: 2, second: "element" }],
  ["flat-map", { index: 0, binds: 1 }],
  ["update", { index: 1, binds: 1 }],
  ["map-err", { index: 0, binds: 1 }],
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
  "floor", // Float.floor → Int
  "ceil", // Float.ceil → Int
  "round", // Float.round → Int (ties go up, toward +∞: (-2.5).round is -2)
  "sqrt", // Int/Float.sqrt → Float
  "log", // Int/Float.log → Float (natural logarithm)
  "exp", // Int/Float.exp → Float
  "pow", // Int/Float.pow(n)
  "to-float", // Int.to-float → Float
  "to-int", // Float.to-int → Int (truncated)
  "is-ok", // Result(T,E).is-ok → Bool
  "is-err", // Result(T,E).is-err → Bool
  "values", // Map(K,V).values → List(V)
  "entries", // Map(K,V).entries → List([K,V])
  "lower", // Text.lower → Text
  "upper", // Text.upper → Text
  "sort", // List(T).sort → List(T)
  "ms", // Time/Duration.ms → Int
]);

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

export const KNOWN_MEMBERS: ReadonlySet<string> = new Set([
  ...KNOWN_METHODS,
  ...FIELD_ACCESS_SHORTCUTS,
]);

function keyKindArg(kind: KeyKind | undefined): string {
  return kind ? `, ${JSON.stringify(kind)}` : "";
}

function fragmentFnCall(method: string, index: number, a: Expr, ctx: EvalCtx): Expr | null {
  if (FRAGMENT_ARGUMENTS.get(method)?.index !== index || a.kind !== "Ref") return null;
  if (ctx.localBinds.has(a.name) || ctx.gen.slots.some((s) => s.name === a.name)) return null;
  const fn = ctx.gen.fns.find((f) => f.name === a.name);
  if (!fn) return null;
  const positionals = ["$1", "$2"].slice(0, fn.params.length);
  return {
    kind: "Call",
    callee: a.name,
    args: positionals.map((name) => ({ kind: "Ref", name, pos: a.pos })),
    pos: a.pos,
  };
}

export function methodCallJs(
  recv: Expr,
  method: string,
  written: Expr[],
  ctx: EvalCtx,
  keyKind?: KeyKind,
  shape?: FragmentShape,
): string {
  if (method === "run-reducer") {
    return `_s.runReducerStep(App, ${jsOfExpr(recv, ctx)}, ${JSON.stringify(reducerNameArg(written[0]))}, _event)`;
  }
  const args = written.map((a, i) => fragmentFnCall(method, i, a, ctx) ?? a);
  const one = childCtx(ctx);
  const p1 = declareBind(one, "$1");
  const two = childCtx(one);
  const p2 = declareBind(two, "$2");

  const recvJs = jsOfExpr(recv, ctx);
  const takenApart = `const ${p1} = __x[0]; const ${p2} = __x[1];`;
  const binds: Record<FragmentShape, string> = {
    pair: takenApart,
    "key-value": takenApart,
    value: `const ${p1} = __x;`,
    undecided: `const _isPair = (Array.isArray(__x) && __x.length === 2); const ${p1} = _isPair ? __x[0] : __x; const ${p2} = _isPair ? __x[1] : (__y !== undefined ? __y : __x);`,
  };
  const decided = shape ?? "undecided";
  const argFnList = (a: Expr): string =>
    `((__x, __y) => { ${binds[decided]} return ${jsOfExpr(a, decided === "value" ? one : two)}; })`;
  const argRaw = (a: Expr): string => jsOfExpr(a, ctx);

  switch (method) {
    case "filter":
      return `_s.filter(${recvJs}, ${argFnList(args[0]!)}${keyKindArg(keyKind)})`;
    case "map":
      return `_s.mapOver(${recvJs}, ${argFnList(args[0]!)}${keyKindArg(keyKind)})`;
    case "flat-map":
      // Option(T).flat-map(f): Some(v) -> f(v) (which itself returns Option), None -> None.
      return `_s.flatMapOption(${recvJs}, ((${p1}) => ${jsOfExpr(args[0]!, one)}))`;
    case "size":
      return `_s.mapSize(${recvJs})`;
    case "keys":
      return `_s.mapKeys(${recvJs}${keyKindArg(keyKind)})`;
    case "has":
      return `_s.setHas(${recvJs}, ${argRaw(args[0]!)})`;
    case "toggle":
      return `_s.setToggle(${recvJs}, ${argRaw(args[0]!)})`;
    case "get":
      if (args.length === 0) return `_s.unwrap(${recvJs})`;
      return `((_v) => _v === undefined ? _s.None : _s.Some(_v))(_s.mapGet(${recvJs}, ${argRaw(args[0]!)}))`;
    case "get-or":
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
      return `_s.listFold(${recvJs}, ${argRaw(args[0]!)}, (${p1}, ${p2}) => ${jsOfExpr(args[1]!, two)})`;
    case "show":
      return `_s.show(${recvJs})`;
    case "is-some":
      return `_s.variantIs(${recvJs}, "Some")`;
    case "is-none":
      return `_s.variantIs(${recvJs}, "None")`;
    case "is-empty":
      return `_s.isEmpty(${recvJs})`;
    case "to-ms":
      return `(${recvJs})`;
    case "copy":
      if (args[0] && args[0].kind === "RecordLit") {
        return `_s.recordCopy(${recvJs}, ${jsOfExpr(args[0], ctx)})`;
      }
      return `_s.recordCopy(${recvJs}, {})`;
    case "find":
      return `_s.listFind(${recvJs}, ${argFnList(args[0]!)})`;
    case "push":
      return `[...(${recvJs} ?? []), ${argRaw(args[0]!)}]`;
    case "unique":
      return `_s.listUnique(${recvJs})`;
    case "reverse":
      return `[...(${recvJs} ?? [])].reverse()`;
    case "join":
      return `((${recvJs}) ?? []).join(${argRaw(args[0]!)})`;
    case "split":
      return `((${recvJs}) ?? "").split(${argRaw(args[0]!)})`;
    case "contains":
      return `_s.contains(${recvJs}, ${argRaw(args[0]!)})`;
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
      return `_s.formatTime(${recvJs}, ${argRaw(args[0]!)})`;
    case "plus":
      // Time.plus(durationMs) / Duration.plus — both stored as raw ms numbers.
      return `((${recvJs}) + (${argRaw(args[0]!)}))`;
    case "minus":
      return `((${recvJs}) - (${argRaw(args[0]!)}))`;
    case "diff":
      // Polymorphic: Time/Duration → numeric magnitude; Set(T) → set difference.
      return `_s.diff(${recvJs}, ${argRaw(args[0]!)})`;
    case "concat":
      return `[...((${recvJs}) ?? []), ...((${argRaw(args[0]!)}) ?? [])]`;
    case "prepend":
      return `[${argRaw(args[0]!)}, ...((${recvJs}) ?? [])]`;
    case "chunk":
      return `_s.listChunk(${recvJs}, ${argRaw(args[0]!)})`;
    case "zip":
      return `_s.listZip(${recvJs}, ${argRaw(args[0]!)})`;
    case "merge":
      return `({ ...((${recvJs}) ?? {}), ...((${argRaw(args[0]!)}) ?? {}) })`;
    case "update":
      // Within expr, $1 is the current value.
      return `_s.mapUpdate(${recvJs}, ${argRaw(args[0]!)}, ((${p1}) => (${jsOfExpr(args[1]!, one)})))`;
    case "add":
      return `_s.setAdd(${recvJs}, ${argRaw(args[0]!)})`;
    case "union":
      return `_s.setUnion(${recvJs}, ${argRaw(args[0]!)})`;
    case "intersect":
      return `_s.setIntersect(${recvJs}, ${argRaw(args[0]!)})`;
    case "or":
      return `_s.or(${recvJs}, ${argRaw(args[0]!)})`;
    case "map-err":
      // Within expr, $1 is the current Err payload.
      return `_s.mapErr(${recvJs}, ((${p1}) => (${jsOfExpr(args[0]!, one)})))`;
    case "replace":
      // Every occurrence, not only the first.
      return `String((${recvJs}) ?? "").replaceAll(${argRaw(args[0]!)}, ${argRaw(args[1]!)})`;
    case "min":
      return `Math.min((${recvJs}), (${argRaw(args[0]!)}))`;
    case "max":
      return `Math.max((${recvJs}), (${argRaw(args[0]!)}))`;
    case "clamp":
      return `Math.min(Math.max((${recvJs}), (${argRaw(args[0]!)})), (${argRaw(args[1]!)}))`;
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

export function emitExprJs(e: Expr & { kind: "EmitExpr" }, ctx: EvalCtx): string {
  const { binds, record } = reducerEmitJs(e.effect, e.args, ctx);
  const spec = `_effects[${JSON.stringify(e.effect)}]`;
  return `((() => { ${binds}const __e = ${record}; _emits.push(__e); return (__e.id = _s.emitId(${spec}, __e)); })())`;
}

export function slotReadJs(name: string, reducerScope: boolean | undefined): string {
  const key = JSON.stringify(name);
  return reducerScope
    ? `(Object.hasOwn(_next, ${key}) ? _next[${key}] : _live[${key}])`
    : `_live[${key}]`;
}

export function reducerEmitJs(
  effect: string,
  args: Expr[],
  ctx: EvalCtx,
): { binds: string; record: string } {
  const effectJson = JSON.stringify(effect);
  const policy = ctx.gen.effects.find((d) => d.name === effect)?.policy;
  if (policy?.kind !== "PolLatestKey") {
    const argsJs = args.map((a) => jsOfExpr(a, ctx)).join(", ");
    return { binds: "", record: `{ effect: ${effectJson}, args: [${argsJs}] }` };
  }
  const argBinds = args.map((a, i) => `const __a${i} = ${jsOfExpr(a, ctx)};`).join(" ");
  const argRefs = args.map((_, i) => `__a${i}`).join(", ");
  const inputRef = args[0] ? "__a0" : "null";
  const keyJs = `${policyKeyOfJs(policy.key, ctx.gen, true)}(${inputRef})`;
  return {
    binds: `${argBinds} const __k = ${keyJs}; `,
    record: `{ effect: ${effectJson}, args: [${argRefs}], key: __k }`,
  };
}

export function policyKeyOfJs(key: Expr, gen: GenCtx, reducerScope: boolean): string {
  const keyCtx = makeEvalCtx(gen, ["$1"], reducerScope);
  return `((${bindRef(keyCtx, "$1")}) => String(${jsOfExpr(key, keyCtx)}))`;
}

export function matchExprJs(e: Expr & { kind: "MatchExpr" }, ctx: EvalCtx): string {
  const sc = jsOfExpr(e.scrutinee, ctx);
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
    const { guard, binds, inner } = tupleArm(p, ctx, scVar);
    return `if (${guard}) { ${binds} return ${jsOfExpr(body, inner)}; }`;
  }
  const tag = p.name;
  const inner = childCtx(ctx);
  const bindAssigns: string[] = [];
  for (let i = 0; i < p.binds.length; i++) {
    const name = p.binds[i]!;
    if (name === "_") continue;
    bindAssigns.push(`const ${declareBind(inner, name)} = (${scVar})[${JSON.stringify(`_${i}`)}];`);
  }
  return `if (_s.variantIs(${scVar}, ${JSON.stringify(tag)})) { ${bindAssigns.join(" ")} return ${jsOfExpr(body, inner)}; }`;
}

export function tupleArm(
  p: Pattern & { kind: "PTuple" },
  ctx: EvalCtx,
  scVar: string,
): { guard: string; binds: string; inner: EvalCtx } {
  const inner = childCtx(ctx);
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

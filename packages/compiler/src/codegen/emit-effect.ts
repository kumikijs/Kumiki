import type { EffectDef, PolicyExpr, RetryExpr } from "../ast.ts";
import { type GenCtx, jsBinding, makeEvalCtx } from "./context.ts";
import { jsOfExpr } from "./expr.ts";

/**
 * The built-in implementation call for a standard capability, given the request
 * variable name. Returns null for custom capabilities (no built-in — a host
 * provider is required).
 */
export function builtinEffectCall(eff: EffectDef, reqVar: string): string | null {
  // Bare names (not `builtinEffects.*`) so the modular build can import each
  // handler from its feature module; the assembled runtime entry exports the
  // same names top-level for the monolith/inlining path (#71).
  if (eff.cap === "storage.read") {
    return `storageRead(${eff.mapRequest ? `{ key: ${reqVar}.key }` : reqVar})`;
  }
  if (eff.cap === "storage.write") {
    return `storageWrite(${
      eff.mapRequest ? `{ key: ${reqVar}.key, value: ${reqVar}.value }` : reqVar
    })`;
  }
  if (eff.cap === "session.read") {
    return `sessionRead(${eff.mapRequest ? `{ key: ${reqVar}.key }` : reqVar})`;
  }
  if (eff.cap === "session.write") {
    return `sessionWrite(${
      eff.mapRequest ? `{ key: ${reqVar}.key, value: ${reqVar}.value }` : reqVar
    })`;
  }
  if (eff.cap === "indexed.read") return `indexedRead(${reqVar}, _idb)`;
  if (eff.cap === "indexed.write") return `indexedWrite(${reqVar}, _idb)`;
  if (eff.cap === "indexed.delete") return `indexedDelete(${reqVar}, _idb)`;
  if (eff.cap === "http.cancel") {
    // cap=http.cancel is a meta-effect — the dispatcher special-cases it and
    // never reaches the invoke. Codegen still needs SOME `invoke` so the
    // EffectSpec shape stays uniform; an immediate `ok` keeps a host
    // provider's mocked behaviour honest if it's ever called through tests.
    return `{ kind: "ok", value: null }`;
  }
  if (eff.cap.startsWith("http.")) {
    const method = eff.cap.slice("http.".length).toUpperCase();
    return `httpFetch(${JSON.stringify(method)}, ${reqVar}, _http, signal)`;
  }
  return null;
}

export function genEffect(eff: EffectDef, gen: GenCtx): string {
  // Every effect invoke follows one shape: (1) map the request if `map-request`
  // is present, (2) consult the host provider for this capability and delegate
  // to it if registered (the ecosystem seam — lets a host swap the HTTP
  // transport, inject auth, mock, etc.), (3) otherwise fall back to the built-in
  // implementation. Custom capabilities have no built-in, so their fallback is a
  // clear "no provider" error.
  const capJs = JSON.stringify(eff.cap);
  const reqVar = eff.mapRequest ? "req" : "input";
  const builtin = builtinEffectCall(eff, reqVar);
  const fallback =
    builtin ??
    `{ kind: "err", value: { message: ${JSON.stringify(`Capability ${eff.cap} has no provider`)} } }`;
  const tail = `const p = caps.provider(${capJs}); if (p) return p(${reqVar}, caps, signal); return ${fallback};`;

  let invokeBody: string;
  if (eff.mapRequest) {
    const mapJs = jsOfExpr(eff.mapRequest, makeEvalCtx(gen, new Set(["$1"])));
    invokeBody = `async (${jsBinding("$1")}, caps, signal) => { const req = ${mapJs}; ${tail} }`;
  } else {
    invokeBody = `async (input, caps, signal) => { ${tail} }`;
  }

  return `{
    name: ${JSON.stringify(eff.name)},
    cap: ${JSON.stringify(eff.cap)},
    policy: ${policyJs(eff.policy)},
    retry: ${retryJs(eff.retry)},
    invoke: ${invokeBody},
  }`;
}

export function retryJs(r?: RetryExpr): string {
  if (!r || r.kind === "RetryNone") return "undefined";
  if (r.kind === "RetryLinear") return `{ kind: "linear", n: ${r.n}, ms: ${r.ms} }`;
  return `{ kind: "exponential", n: ${r.n}, ms: ${r.ms}, factor: ${r.factor} }`;
}

export function policyJs(p?: PolicyExpr): string {
  if (!p) return "undefined";
  switch (p.kind) {
    case "PolLatest":
      return `{ kind: "latest" }`;
    case "PolLatestKey":
      return `{ kind: "latest-per-key", keyOf: ((${jsBinding("$1")}) => String(${jsOfExpr(p.key, { gen: {} as GenCtx, localBinds: new Set(["$1"]) })})) }`;
    case "PolQueue":
      return `{ kind: "queue" }`;
    case "PolDebounce":
      return `{ kind: "debounce", ms: ${p.ms} }`;
    case "PolThrottle":
      return `{ kind: "throttle", ms: ${p.ms} }`;
    case "PolOnce":
      return `{ kind: "once" }`;
  }
}

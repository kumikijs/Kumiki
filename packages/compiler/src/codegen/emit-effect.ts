import { type TypeEnv, unaliasType } from "../assignable.ts";
import type { EffectDef, PolicyExpr, RetryExpr } from "../ast.ts";
import { failsWithText } from "../capabilities.ts";
import { bindRef, type GenCtx, makeEvalCtx } from "./context.ts";
import { jsOfExpr, policyKeyOfJs } from "./expr.ts";

export type StorageHandler =
  | "storageRead"
  | "storageWrite"
  | "storageClear"
  | "sessionRead"
  | "sessionWrite"
  | "sessionClear";

/**
 * The `effects-storage` handler an effect calls, or null when it is not a
 * storage effect. One answer for both the call codegen emits and the import
 * that ships it, so the two cannot drift.
 *
 * A clear (http.md §6.7.2) is decided here, from the declaration: `in=Unit`
 * (through any alias) with no `map-request`. It is not left to the runtime to
 * infer from an empty request, because an empty request is also what a Map
 * index that found nothing produces, and a clear takes the whole origin with
 * it. A write and a remove stay one handler: `map-request` is an arbitrary
 * expression, so only the request it builds can tell them apart.
 */
export function storageHandlerOf(eff: EffectDef, env: TypeEnv): StorageHandler | null {
  const backend =
    eff.cap === "storage.read" || eff.cap === "storage.write"
      ? "storage"
      : eff.cap === "session.read" || eff.cap === "session.write"
        ? "session"
        : null;
  if (!backend) return null;
  if (eff.cap.endsWith(".read")) return `${backend}Read`;
  const inType = unaliasType(eff.inType, env);
  const clears = !eff.mapRequest && inType?.kind === "TypePrim" && inType.name === "Unit";
  return clears ? `${backend}Clear` : `${backend}Write`;
}

/**
 * The built-in implementation call for a standard capability, given the request
 * variable name. Returns null for custom capabilities (no built-in — a host
 * provider is required).
 */
export function builtinEffectCall(eff: EffectDef, reqVar: string, env: TypeEnv): string | null {
  // Bare names (not `builtinEffects.*`) so the modular build can import each
  // handler from its feature module; the assembled runtime entry exports the
  // same names top-level for the monolith/inlining path (#71).
  const storage = storageHandlerOf(eff, env);
  if (storage?.endsWith("Read")) {
    return `${storage}(${eff.mapRequest ? `{ key: ${reqVar}.key, decode: ${reqVar}.decode }` : reqVar})`;
  }
  if (storage?.endsWith("Clear")) return `${storage}()`;
  // A write's request goes through whole, on both storage.write and
  // session.write: whether it carries a `value` field is what tells a write
  // from a remove (http.md §6.7.2).
  if (storage) return `${storage}(${reqVar})`;
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
    return `httpFetch(${JSON.stringify(method)}, ${reqVar}, _http, _signal)`;
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
  const reqVar = eff.mapRequest ? "_req" : "_input";
  const builtin = builtinEffectCall(eff, reqVar, gen);
  const fallback =
    builtin ??
    `{ kind: "err", value: { message: ${JSON.stringify(`Capability ${eff.cap} has no provider`)} } }`;
  // An effect that fails with `Text` (capabilities.ts) delivers a throw as
  // that `Text` too — from its `map-request` or a host provider. Left to the
  // dispatcher, which cannot know `E`, it would arrive as `{message: …}`.
  // `await` keeps a provider's rejected promise inside the `try`.
  const textFailure = failsWithText(eff.cap);
  const providerCall = `${textFailure ? "await " : ""}_provider(${reqVar}, _caps, _signal)`;
  const tail = `const _provider = _caps.provider(${capJs}); if (_provider) return ${providerCall}; return ${fallback};`;
  const mapped = eff.mapRequest ? makeEvalCtx(gen, ["$1"]) : null;
  const head = mapped && eff.mapRequest ? `const _req = ${jsOfExpr(eff.mapRequest, mapped)}; ` : "";
  const body = textFailure
    ? `try { ${head}${tail} } catch (_thrown) { return { kind: "err", value: String(_thrown) }; }`
    : `${head}${tail}`;
  const invokeBody = `async (${mapped ? bindRef(mapped, "$1") : "_input"}, _caps, _signal) => { ${body} }`;

  return `{
    name: ${JSON.stringify(eff.name)},
    cap: ${JSON.stringify(eff.cap)},
    policy: ${policyJs(gen, eff.policy)},
    retry: ${retryJs(eff.retry)},
    invoke: ${invokeBody},
  }`;
}

export function retryJs(r?: RetryExpr): string {
  if (!r || r.kind === "RetryNone") return "undefined";
  if (r.kind === "RetryLinear") return `{ kind: "linear", n: ${r.n}, ms: ${r.ms} }`;
  return `{ kind: "exponential", n: ${r.n}, ms: ${r.ms}, factor: ${r.factor} }`;
}

/**
 * Lower an effect's `policy=` to the descriptor the dispatcher reads. Only
 * `latest-per-key` carries an expression: the key lambda, whose scope is the
 * ordinary non-reducer one plus its own `$1`. `gen` is what lets that
 * expression see the slot table — without it a slot reference lowered to a bare
 * identifier, and because the lambda body only runs when the effect is
 * dispatched, the app imported, mounted and rendered before throwing.
 */
export function policyJs(gen: GenCtx, p?: PolicyExpr): string {
  if (!p) return "undefined";
  switch (p.kind) {
    case "PolLatest":
      return `{ kind: "latest" }`;
    case "PolLatestKey":
      // Not reducer scope: this lands in the effect table inside `createApp()`,
      // where `_next` is unbound — it is local to each reducer's generated body
      // — so a slot read here must be `_live[...]`. The dispatcher calls
      // `keyOf` only for an emit that carries no key of its own, such as an
      // `app.init` entry; a reducer's emit carries the key it was given where
      // it ran (`reducerEmitJs`).
      return `{ kind: "latest-per-key", keyOf: ${policyKeyOfJs(p.key, gen, false)} }`;
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

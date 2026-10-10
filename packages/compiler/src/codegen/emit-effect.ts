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

export function builtinEffectCall(eff: EffectDef, reqVar: string, env: TypeEnv): string | null {
  const storage = storageHandlerOf(eff, env);
  if (storage?.endsWith("Read")) {
    return `${storage}(${eff.mapRequest ? `{ key: ${reqVar}.key, decode: ${reqVar}.decode }` : reqVar})`;
  }
  if (storage?.endsWith("Clear")) return `${storage}()`;
  if (storage) return `${storage}(${reqVar})`;
  if (eff.cap === "indexed.read") return `indexedRead(${reqVar}, _idb)`;
  if (eff.cap === "indexed.write") return `indexedWrite(${reqVar}, _idb)`;
  if (eff.cap === "indexed.delete") return `indexedDelete(${reqVar}, _idb)`;
  if (eff.cap === "http.cancel") {
    return `{ kind: "ok", value: null }`;
  }
  if (eff.cap.startsWith("http.")) {
    const method = eff.cap.slice("http.".length).toUpperCase();
    return `httpFetch(${JSON.stringify(method)}, ${reqVar}, _http, _signal)`;
  }
  return null;
}

export function genEffect(eff: EffectDef, gen: GenCtx): string {
  const capJs = JSON.stringify(eff.cap);
  const reqVar = eff.mapRequest ? "_req" : "_input";
  const builtin = builtinEffectCall(eff, reqVar, gen);
  const fallback =
    builtin ??
    `{ kind: "err", value: { message: ${JSON.stringify(`Capability ${eff.cap} has no provider`)} } }`;
  const mapped = eff.mapRequest ? makeEvalCtx(gen, ["$1"]) : null;
  const head = mapped && eff.mapRequest ? `const _req = ${jsOfExpr(eff.mapRequest, mapped)}; ` : "";
  const params = `${mapped ? bindRef(mapped, "$1") : "_input"}, _caps, _signal`;
  const lookup = `const _provider = _caps.provider(${capJs});`;
  const call = `_provider(${reqVar}, _caps, _signal)`;
  const body = failsWithText(eff.cap)
    ? `try { ${head}${lookup} const _r = await (_provider ? ${call} : ${fallback}); if (_r?.kind === "ok") return _r; if (_r?.kind === "err") return { kind: "err", value: _errText(_r.value) }; throw new Error(${JSON.stringify(`the ${eff.cap} provider returned `)} + _errText(_r) + ", not {kind, value}"); } catch (_thrown) { return { kind: "err", value: _errText(_thrown), final: true }; }`
    : `${head}${lookup} if (_provider) return ${call}; return ${fallback};`;
  const invokeBody = `async (${params}) => { ${body} }`;
  const errText = failsWithText(eff.cap) ? "\n    errText: _errText," : "";

  return `{
    name: ${JSON.stringify(eff.name)},
    cap: ${JSON.stringify(eff.cap)},
    policy: ${policyJs(gen, eff.policy)},
    retry: ${retryJs(eff.retry)},
    invoke: ${invokeBody},${errText}
  }`;
}

export function retryJs(r?: RetryExpr): string {
  if (!r || r.kind === "RetryNone") return "undefined";
  if (r.kind === "RetryLinear") return `{ kind: "linear", n: ${r.n}, ms: ${r.ms} }`;
  return `{ kind: "exponential", n: ${r.n}, ms: ${r.ms}, factor: ${r.factor} }`;
}

export function policyJs(gen: GenCtx, p?: PolicyExpr): string {
  if (!p) return "undefined";
  switch (p.kind) {
    case "PolLatest":
      return `{ kind: "latest" }`;
    case "PolLatestKey":
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

export const TEXT_FAILURE_HELPER = `function _errText(v) {
  try {
    if (typeof v === "string") return v;
    if (v instanceof Error) return String(v);
    if (typeof v?.message === "string") return v.message;
    return JSON.stringify(v) ?? String(v);
  } catch {
    return "the effect failed with a value that cannot be shown as Text";
  }
}`;

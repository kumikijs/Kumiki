// Shared compile→preview pipeline for the docs site. Both the playground
// editor and the home-page live demo compile Kumiki in the browser and run
// the result inside the same sandboxed srcdoc iframe.

import { compile, parseCapabilityManifest } from "@kumikijs/compiler";
// The prebuilt runtime bundle, inlined as a string so generated apps are
// fully self-contained and runnable inside the preview iframe.
import runtimeBundle from "@kumikijs/runtime/bundle?raw";

// Load every feature example at build time so the playground ships with a
// browsable catalog. Sources live in packages/examples (repo root is ../../..).
const exampleModules = import.meta.glob("../../../packages/examples/features/*.kumiki", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const examples: { name: string; source: string }[] = Object.entries(exampleModules)
  .map(([path, source]) => ({ name: path.split("/").pop() ?? path, source }))
  .sort((a, b) => a.name.localeCompare(b.name));

// The examples directory ships a `kumiki.caps.json` registering project-specific
// capabilities (e.g. telemetry.track for 27-custom-capability). The CLI resolves
// it from disk; here we load it at build time and pass the registered names to
// check()/compile() so those examples typecheck instead of failing E0302.
const capsModules = import.meta.glob("../../../packages/examples/features/kumiki.caps.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const capsRaw = Object.values(capsModules)[0];
const capsParsed = capsRaw ? parseCapabilityManifest(JSON.parse(capsRaw)) : null;
export const capabilities: string[] = capsParsed?.ok ? capsParsed.manifest.capabilities : [];

export function compileToJs(source: string): ReturnType<typeof compile> {
  return compile(source, {
    runtimeSpecifier: "",
    bundle: true,
    readRuntimeBundle: () => runtimeBundle,
    capabilities,
  });
}

// The preview iframe is a sandboxed srcdoc (opaque origin, no real path, no
// network). Configure the embedding seams before the auto-mounting module runs:
//  - memory router (#36) so routing examples (18/23) initialise at "/" and
//    navigate instead of falling to /404;
//  - a deterministic http.get provider (#38) so the HTTP showcase (19) serves
//    its /api/quote offline and demonstrates the SUCCESS path;
//  - a telemetry.track provider so the custom-capability showcase (27) — which
//    has no built-in and would otherwise always hit its `.err` branch ("no
//    telemetry provider") — demonstrates the SUCCESS path;
//  - an in-memory localStorage shim, installed only when the sandbox's opaque
//    origin makes the real one throw, so the storage showcase (20) persists
//    within the session and shows "saved" instead of always "storage
//    unavailable". The runtime's own storage built-in (Option-wrapping, JSON)
//    runs unchanged on top of it. All seams use the runtime's documented
//    embedding points — no fetch patching, no sandbox weakening.
const PREVIEW_PREAMBLE = `globalThis.__kumikiMount = { router: "memory" };
try { void localStorage.length; } catch (_e) {
  const _store = Object.create(null);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (k in _store ? _store[k] : null),
      setItem: (k, v) => { _store[k] = String(v); },
      removeItem: (k) => { delete _store[k]; },
      clear: () => { for (const k in _store) delete _store[k]; },
    },
  });
}
globalThis.__kumikiProviders = {
  "http.get": (input) => {
    const url = (input && input.url) || "";
    const response = url.indexOf("/api/quote") !== -1
      ? { kind: "ok", value: { text: "Make it work, make it right, make it fast.", author: "Kent Beck" } }
      : { kind: "err", value: { message: "no demo backend for " + url } };
    // A sync return would jump Loading -> Loaded within one frame, so the
    // Loading/spinner state would never paint. Resolve like a real network.
    return new Promise((resolve) => setTimeout(() => resolve(response), 1000));
  },
  "telemetry.track": (input) => {
    console.log("[telemetry]", input);
    return { kind: "ok", value: null };
  },
};`;

export function buildSrcdoc(js: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}</style></head>
<body><div id="root"></div>
<script>${PREVIEW_PREAMBLE}</script>
<script type="module">${js}</script></body></html>`;
}

export type ExamplePreview = { kind: "ok"; srcdoc: string } | { kind: "err"; message: string };

export function compileExample(name: string): ExamplePreview {
  const example = examples.find((e) => e.name === name);
  if (!example) return { kind: "err", message: `unknown example: ${name}` };
  const result = compileToJs(example.source);
  if (result.kind === "fail") {
    return { kind: "err", message: result.errors.map((e) => `${e.code} ${e.message}`).join("; ") };
  }
  return { kind: "ok", srcdoc: buildSrcdoc(result.js) };
}

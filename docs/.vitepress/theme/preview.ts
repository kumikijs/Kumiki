import { compile, parseCapabilityManifest } from "@kumikijs/compiler";
import runtimeBundle from "@kumikijs/runtime/bundle?raw";

const exampleModules = import.meta.glob("../../../packages/examples/features/*.kumiki", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const examples: { name: string; source: string }[] = Object.entries(exampleModules)
  .map(([path, source]) => ({ name: path.split("/").pop() ?? path, source }))
  .sort((a, b) => a.name.localeCompare(b.name));

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

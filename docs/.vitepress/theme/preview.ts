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

const SANDBOX_PREAMBLE = `globalThis.__kumikiMount = { router: "memory" };
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
}`;

const TELEMETRY_PROVIDER = `"telemetry.track": (input) => {
    console.log("[telemetry]", input);
    return { kind: "ok", value: null };
  }`;

export const TELEMETRY_ONLY = `globalThis.__kumikiProviders = { ${TELEMETRY_PROVIDER} };`;

export const DEMO_PROVIDERS = `globalThis.__kumikiProviders = {
  "http.get": (input) => {
    const url = (input && input.url) || "";
    const response = url.indexOf("/api/quote") !== -1
      ? { kind: "ok", value: { text: "Make it work, make it right, make it fast.", author: "Kent Beck" } }
      : { kind: "err", value: { message: "no demo backend for " + url } };
    // A sync return would jump Loading -> Loaded within one frame, so the Loading state would never paint.
    return new Promise((resolve) => setTimeout(() => resolve(response), 1000));
  },
  ${TELEMETRY_PROVIDER},
};`;

export function buildSrcdoc(js: string, seams: string = DEMO_PROVIDERS): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px}</style></head>
<body><div id="root"></div>
<script>${SANDBOX_PREAMBLE}
${seams}</script>
<script type="module">${js}</script></body></html>`;
}

// Without allow-forms Chromium blocks a sandboxed form's submission before `submit` fires,
// and the form tile only reacts to `submit`.
export const PREVIEW_SANDBOX = "allow-scripts allow-forms";

export type ExamplePreview = { kind: "ok"; srcdoc: string } | { kind: "err"; message: string };

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function previewDocument(source: string, seams?: string): ExamplePreview {
  let result: ReturnType<typeof compile>;
  try {
    result = compileToJs(source);
  } catch (e) {
    return { kind: "err", message: errorMessage(e) };
  }
  if (result.kind === "fail") {
    return { kind: "err", message: result.errors.map((e) => `${e.code} ${e.message}`).join("; ") };
  }
  return { kind: "ok", srcdoc: buildSrcdoc(result.js, seams) };
}

export function compileExample(name: string): ExamplePreview {
  const example = examples.find((e) => e.name === name);
  if (!example) return { kind: "err", message: `unknown example: ${name}` };
  return previewDocument(example.source);
}

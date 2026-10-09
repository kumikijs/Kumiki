import { buildSrcdoc, compileToJs, type ExamplePreview, TELEMETRY_ONLY } from "./preview";

const raw = (modules: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(modules).map(([path, text]) => [path.split("/").at(-2) ?? path, String(text)]),
  );

const sources = raw(
  import.meta.glob("../../../packages/examples/apps/*/app.kumiki", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
const fixtures = raw(
  import.meta.glob("../../../packages/examples/apps/*/app.http.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
const readmes = {
  en: raw(
    import.meta.glob("../../../packages/examples/apps/*/README.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ),
  ja: raw(
    import.meta.glob("../../../packages/examples/apps/*/README.ja.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ),
};

export type Lang = keyof typeof readmes;

export type ShowcaseApp = {
  name: string;
  title: string;
  summary: string;
  learn: string[];
  lines: number;
  source: string;
};

export function parseReadme(readme: string): Pick<ShowcaseApp, "title" | "summary" | "learn"> {
  const blocks = readme.split(/\n\s*\n/).map((b) => b.trim());
  const heading = blocks.find((b) => b.startsWith("# ")) ?? "";
  const title = heading.replace(/^# /, "").replace(/^\d+\s*—\s*/, "");
  const prose = blocks.filter((b) => !/^[#[\-`|]|^English ·/.test(b));
  const learnAt = blocks.findIndex((b) => /^## (What you'll learn|学べること)/.test(b));
  const learn =
    learnAt === -1
      ? []
      : (blocks[learnAt + 1] ?? "")
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2));
  return { title, summary: (prose[0] ?? "").replace(/\s*\n\s*/g, " "), learn };
}

export function showcaseApps(lang: Lang): ShowcaseApp[] {
  return Object.keys(sources)
    .sort()
    .map((name) => {
      const source = sources[name] ?? "";
      return {
        name,
        ...parseReadme(readmes[lang][name] ?? readmes.en[name] ?? `# ${name}`),
        lines: source.trimEnd().split("\n").length,
        source,
      };
    });
}

type FixtureResponse = {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
};
export type HttpFixture = Record<string, FixtureResponse | FixtureResponse[]>;

// Serialized into the preview iframe with Function#toString, so it must not close over anything.
export function installFixtureFetch(fixture: HttpFixture, latencyMs: number): void {
  const cursors: Record<string, number> = {};
  const next = (key: string): FixtureResponse | undefined => {
    const entry = fixture[key];
    if (!Array.isArray(entry)) return entry;
    const at = cursors[key] ?? 0;
    cursors[key] = at + 1;
    return entry[Math.min(at, entry.length - 1)];
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const target = new URL(url, "http://localhost/");
    const withQuery = `${method} ${target.pathname}${target.search}`;
    const key = withQuery in fixture ? withQuery : `${method} ${target.pathname}`;
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
    const found = next(key);
    if (!found) return new Response(`no demo response for ${withQuery}`, { status: 404 });
    const body = found.json !== undefined ? JSON.stringify(found.json) : (found.text ?? "");
    const headers = new Headers(found.headers);
    if (found.json !== undefined) headers.set("content-type", "application/json");
    return new Response(body, { status: found.status ?? 200, headers });
  };
}

const FETCH_LATENCY_MS = 400;

export function fixturePreamble(fixture: HttpFixture | undefined): string {
  if (!fixture) return "";
  return `(${installFixtureFetch.toString()})(${JSON.stringify(fixture)}, ${FETCH_LATENCY_MS});`;
}

export function previewApp(name: string): ExamplePreview {
  const source = sources[name];
  if (source === undefined) return { kind: "err", message: `unknown app: ${name}` };
  const result = compileToJs(source);
  if (result.kind === "fail") {
    return { kind: "err", message: result.errors.map((e) => `${e.code} ${e.message}`).join("; ") };
  }
  const fixture = fixtures[name];
  const preamble = fixturePreamble(fixture ? (JSON.parse(fixture) as HttpFixture) : undefined);
  return { kind: "ok", srcdoc: buildSrcdoc(result.js, `${TELEMETRY_ONLY}\n${preamble}`) };
}

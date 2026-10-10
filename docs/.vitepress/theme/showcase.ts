import { type ExamplePreview, errorMessage, previewDocument, TELEMETRY_ONLY } from "./preview";

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
    if (!found) {
      // The runtime reports a failed response by its statusText, so the miss has to be named there.
      const miss = `no demo response for ${withQuery}`;
      console.error(miss);
      return new Response(miss, { status: 404, statusText: miss });
    }
    const status = found.status ?? 200;
    const body = found.json !== undefined ? JSON.stringify(found.json) : (found.text ?? "");
    const headers = new Headers(found.headers);
    if (found.json !== undefined) headers.set("content-type", "application/json");
    // The Response constructor throws on a 204 or 205 that carries any body, even an empty string.
    return new Response(status === 204 || status === 205 ? null : body, { status, headers });
  };
}

const FETCH_LATENCY_MS = 400;

export function fixturePreamble(fixture: HttpFixture | undefined): string {
  if (!fixture) return "";
  return `(${installFixtureFetch.toString()})(${JSON.stringify(fixture)}, ${FETCH_LATENCY_MS});`;
}

export function previewSource(source: string, fixture: string | undefined): ExamplePreview {
  let parsed: HttpFixture | undefined;
  try {
    parsed = fixture === undefined ? undefined : (JSON.parse(fixture) as HttpFixture);
  } catch (e) {
    return { kind: "err", message: `app.http.json: ${errorMessage(e)}` };
  }
  return previewDocument(source, `${TELEMETRY_ONLY}\n${fixturePreamble(parsed)}`);
}

export function previewApp(name: string): ExamplePreview {
  const source = sources[name];
  if (source === undefined) return { kind: "err", message: `unknown app: ${name}` };
  return previewSource(source, fixtures[name]);
}

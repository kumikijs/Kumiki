import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The workflow guides `kumiki guide` prints, in the order it lists them. */
export const GUIDES = [
  {
    name: "author",
    summary: "write a Kumiki program: the 7 layers, the idioms that trip people up",
  },
  {
    name: "debug",
    summary: "read a diagnostic, apply a fix, and chase an app that checks but misbehaves",
  },
  { name: "iterate", summary: "turn requirements into a scenario and loop until it passes" },
] as const;

export type GuideRoots = { guides: string; spec: string };

export type Guide = { kind: "guide" | "diagnostic" | "spec"; text: string };

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the guides and the spec are read from. The build copies both beside the bundled CLI, so an
 * installed `kumiki` answers from the spec of its own version; run from source, they are the
 * repository's. `KUMIKI_SPEC_DIR` points at another spec.
 */
export function guideRoots(): GuideRoots {
  const bundled = join(here, "spec");
  const spec =
    process.env.KUMIKI_SPEC_DIR ??
    (existsSync(bundled) ? bundled : join(here, "..", "..", "..", "docs", "spec"));
  return { guides: join(here, "guides"), spec };
}

export function specDocs(roots: GuideRoots = guideRoots()): string[] {
  if (!existsSync(roots.spec)) return [];
  return readdirSync(roots.spec)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -".md".length))
    .sort();
}

export function guideTopics(roots: GuideRoots = guideRoots()): {
  guides: typeof GUIDES;
  spec: string[];
} {
  return { guides: GUIDES, spec: specDocs(roots) };
}

/** What `kumiki guide` prints with no topic. */
export function guideListing(roots: GuideRoots = guideRoots()): string {
  const { guides, spec } = guideTopics(roots);
  const width = Math.max(...guides.map((g) => g.name.length));
  return [
    "Guides for writing Kumiki, from the spec this CLI ships with:",
    "",
    ...guides.map((g) => `  kumiki guide ${g.name.padEnd(width)}  ${g.summary}`),
    "",
    "A diagnostic's entry in the error catalog:",
    "",
    "  kumiki guide E0201",
    "",
    "A spec document:",
    "",
    `  ${spec.join(", ")}`,
    "",
  ].join("\n");
}

/** Why `topic` names nothing, with the topics that do. */
export function unknownTopic(topic: string, roots: GuideRoots = guideRoots()): string {
  const { guides, spec } = guideTopics(roots);
  const names = [...guides.map((g) => g.name), ...spec].join(", ");
  return `no guide for "${topic}". Topics: ${names}, or a diagnostic code such as E0201.`;
}

const CODE = /^[EW]\d{4}$/i;

/** The guide, diagnostic entry or spec document `topic` names, or `null` when it names none. */
export function readGuide(topic: string, roots: GuideRoots = guideRoots()): Guide | null {
  if (GUIDES.some((g) => g.name === topic)) {
    return { kind: "guide", text: readFileSync(join(roots.guides, `${topic}.md`), "utf8") };
  }
  if (CODE.test(topic)) {
    const entry = diagnosticEntry(topic.toUpperCase(), roots);
    return entry === null ? null : { kind: "diagnostic", text: entry };
  }
  const doc = topic.endsWith(".md") ? topic.slice(0, -".md".length) : topic;
  if (!specDocs(roots).includes(doc)) return null;
  return { kind: "spec", text: readFileSync(join(roots.spec, `${doc}.md`), "utf8") };
}

/** The error catalog's entry for `code`: its heading through the line before the next entry or band. */
function diagnosticEntry(code: string, roots: GuideRoots): string | null {
  const path = join(roots.spec, "errors.md");
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`### ${code} `));
  if (start === -1) return null;
  const next = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  const body = lines.slice(start, next === -1 ? lines.length : next);
  return `${body.join("\n").trimEnd()}\n`;
}

// Every ```kumiki block in docs/ is a claim about the language, and until now
// nothing checked any of them: more than half the spec's blocks did not parse,
// and 27 of them used `;` as a comment, which the grammar three sections up
// defines as a statement separator.
//
// A block is one of four kinds, and each kind is falsifiable in both
// directions, so a wrong mark fails as loudly as a wrong block:
//
//   (unmarked)  a complete program        — parses and checks clean
//   fragment    definitions, no `app`     — parses, and does NOT check clean
//   snippet     less than a definition    — does NOT parse
//   invalid     a deliberately bad example — fails, at parse or at check
//
// `caps=a.b,c.d` may accompany any kind and is the manifest the block is
// checked against; an entry the block never uses fails, so it cannot be used
// to silence a real E0302.
//
// The boundary worth knowing: a `fragment` is only parsed, because checking one
// would report every name its surrounding prose supplies. A typo inside a
// fragment's expression is not caught here.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { check, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..");
const docsRoot = join(repoRoot, "docs");

const KINDS = ["fragment", "snippet", "invalid"] as const;
type Kind = (typeof KINDS)[number] | "program";

type Block = {
  /** Repo-relative path with forward slashes, e.g. `docs/spec/style.md`. */
  file: string;
  /** 1-based line of the block's first line of code. */
  line: number;
  kind: Kind;
  caps: string[];
  meta: string;
  code: string;
};

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Parse a fence's info string past the language: kind and `caps=`. */
function parseMeta(meta: string, where: string): { kind: Kind; caps: string[] } {
  let kind: Kind = "program";
  let caps: string[] = [];
  for (const word of meta.split(/\s+/).filter(Boolean)) {
    if (word.startsWith("caps=")) {
      caps = word.slice("caps=".length).split(",").filter(Boolean);
      continue;
    }
    if ((KINDS as readonly string[]).includes(word)) {
      kind = word as Kind;
      continue;
    }
    throw new Error(
      `${where}: unknown mark "${word}" on a kumiki block — use one of ${KINDS.join(" / ")}, or caps=a.b,c.d`,
    );
  }
  return { kind, caps };
}

function blocksIn(file: string): Block[] {
  const rel = relative(repoRoot, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opener = /^```kumiki(\s.*)?$/.exec(lines[i] ?? "");
    if (!opener) continue;
    const meta = (opener[1] ?? "").trim();
    const start = i + 1;
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
      body.push(lines[i] ?? "");
      i++;
    }
    const where = `${rel}:${start}`;
    out.push({ file: rel, line: start, ...parseMeta(meta, where), meta, code: body.join("\n") });
  }
  return out;
}

const ALL_BLOCKS: Block[] = markdownFiles(docsRoot).flatMap(blocksIn);
const at = (b: Block): string => `${b.file}:${b.line}`;

type Outcome =
  | { ok: true; diagnostics: KumikiError[] }
  | { ok: false; stage: "parse"; message: string };

function compileBlock(b: Block): Outcome {
  try {
    const program = parse(lex(b.code));
    const diagnostics = check(program, { capabilities: b.caps }).filter(
      (d) => d.severity !== "warning",
    );
    return { ok: true, diagnostics };
  } catch (e) {
    return { ok: false, stage: "parse", message: (e as Error).message };
  }
}

const kindOf = (kind: Kind): Block[] => ALL_BLOCKS.filter((b) => b.kind === kind);

describe("every kumiki block in docs/ is what it says it is", () => {
  it("has blocks of every kind to check", () => {
    // Floors, so deleting or re-marking the corpus cannot turn this suite
    // green. The shape they record: the documentation teaches in fragments —
    // definitions without the `app` that would make them runnable — and only a
    // handful of blocks are whole programs.
    expect(ALL_BLOCKS.length).toBeGreaterThan(250);
    expect(kindOf("program").length).toBeGreaterThanOrEqual(6);
    expect(kindOf("fragment").length).toBeGreaterThan(150);
    expect(kindOf("snippet").length).toBeGreaterThan(50);
    expect(kindOf("invalid").length).toBeGreaterThanOrEqual(4);
  });

  it("compiles every unmarked block as a complete program", () => {
    const failures: string[] = [];
    for (const b of kindOf("program")) {
      const r = compileBlock(b);
      if (!r.ok) failures.push(`${at(b)} — ${r.message}`);
      else if (r.diagnostics.length > 0) {
        failures.push(
          `${at(b)} — ${r.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("parses every fragment, and finds each one incomplete", () => {
    const failures: string[] = [];
    for (const b of kindOf("fragment")) {
      const r = compileBlock(b);
      if (!r.ok) failures.push(`${at(b)} — marked fragment but does not parse: ${r.message}`);
      else if (r.diagnostics.length === 0) {
        failures.push(`${at(b)} — marked fragment but is a complete program; drop the mark`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("finds every snippet to be less than a program", () => {
    const failures = kindOf("snippet")
      .filter((b) => compileBlock(b).ok)
      .map((b) => `${at(b)} — marked snippet but parses; mark it fragment, or drop the mark`);
    expect(failures).toEqual([]);
  });

  it("finds every invalid block rejected", () => {
    const failures = kindOf("invalid")
      .filter((b) => {
        const r = compileBlock(b);
        return r.ok && r.diagnostics.length === 0;
      })
      .map((b) => `${at(b)} — marked invalid but compiles clean`);
    expect(failures).toEqual([]);
  });

  it("declares no capability a block does not use", () => {
    const failures: string[] = [];
    for (const b of ALL_BLOCKS.filter((x) => x.caps.length > 0)) {
      for (const cap of b.caps) {
        if (!b.code.includes(cap)) failures.push(`${at(b)} — caps=${cap} is never used`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("uses `;` only as the separator the grammar says it is", () => {
    // `#` starts a comment (language.md §1.2); `;` separates statements. A
    // block that uses `;` for prose does not parse, which the assertions above
    // already catch — this one names the cause instead of the symptom.
    const failures: string[] = [];
    for (const b of ALL_BLOCKS) {
      for (const [i, raw] of b.code.split("\n").entries()) {
        // Only code, so a `;` inside a comment stays a `;`.
        const line = raw.split("#")[0] ?? "";
        // Prose after a separator: no operator, no call, no assignment.
        const m = /;\s*([^\s;].*)$/.exec(line);
        const rest = m?.[1] ?? "";
        if (rest && !/[(){}[\]=:|]|->|:=/.test(rest)) {
          failures.push(`${b.file}:${b.line + i} — "; ${rest.slice(0, 40)}" reads as a comment`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("marks a document's blocks the same way in English and Japanese", () => {
    const failures: string[] = [];
    for (const b of ALL_BLOCKS) {
      if (b.file.startsWith("docs/ja/")) continue;
      const jaFile = b.file.replace("docs/", "docs/ja/");
      const ja = ALL_BLOCKS.filter((x) => x.file === jaFile);
      if (ja.length === 0) continue;
      const en = ALL_BLOCKS.filter((x) => x.file === b.file);
      if (en.length !== ja.length) {
        failures.push(`${b.file} has ${en.length} blocks, ${jaFile} has ${ja.length}`);
        continue;
      }
      const index = en.indexOf(b);
      const mate = ja[index] as Block;
      if (mate.meta !== b.meta) {
        failures.push(
          `${at(b)} is "${b.meta || "(none)"}" but ${at(mate)} is "${mate.meta || "(none)"}"`,
        );
      }
    }
    expect([...new Set(failures)]).toEqual([]);
  });
});

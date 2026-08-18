// Every ```kumiki block in docs/ is a claim about the language, and until now
// nothing checked any of them: 123 of 287 did not parse, and 27 of those used
// `;` as a comment, which the grammar three sections up defines as a statement
// separator.
//
// A block is one of four kinds, and each kind is falsifiable in both
// directions, so a wrong mark fails as loudly as a wrong block:
//
//   (unmarked)  a complete program        — parses and checks clean
//   fragment    definitions, no `app`     — parses, and does NOT check clean
//   snippet     less than a definition    — does NOT parse
//   invalid     a deliberately bad example — fails, at parse or at check
//
// Two boundaries worth knowing:
//
//   - A `fragment` is only asked to be incomplete. Checking one against its
//     surrounding prose is not possible, so a typo inside a fragment's
//     expression is not caught here.
//   - `check()` runs with its defaults, which filter out the opt-in bands
//     (E07xx a11y, E0704 unknown-icon, E0212 selector-id) before this suite
//     sees them, and the warning tier (W02xx) is dropped below. A documented
//     example whose handler the compiler silently drops would still read as
//     clean.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check, type KumikiError, LexError, lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

/** A fence with leading whitespace — inside a list item, say. */
const INDENTED_FENCE = /^\s+```kumiki/;

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

/** Repo-relative, forward-slashed, so a failure reads the same on every OS. */
function relPath(file: string): string {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

function blocksIn(file: string): Block[] {
  const rel = relPath(file);
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

type Outcome = { ok: true; diagnostics: KumikiError[] } | { ok: false; message: string };

/**
 * `requireApp: false` drops `E0003 missing-app`, which every block without an
 * `app` earns and which therefore says nothing about the block's content. The
 * two views are what separate "incomplete" from "wrong": a fragment is the
 * first, an invalid example has to be the second.
 */
function compileBlock(b: Block, requireApp = true): Outcome {
  let program: ReturnType<typeof parse>;
  try {
    program = parse(lex(b.code));
  } catch (e) {
    // Only a lex/parse failure means "this is not a program". A crash inside
    // the checker is a defect in the checker, and must not read here as a
    // `snippet` passing its assertion.
    if (e instanceof LexError || e instanceof ParseError)
      return { ok: false, message: (e as Error).message };
    throw e;
  }
  const diagnostics = check(program, { requireApp, capabilities: [] }).filter(
    (d) => d.severity !== "warning",
  );
  return { ok: true, diagnostics };
}

const kindOf = (kind: Kind): Block[] => ALL_BLOCKS.filter((b) => b.kind === kind);

describe("every kumiki block in docs/ is what it says it is", () => {
  it("has blocks of every kind to check", () => {
    // Floors, so deleting or re-marking the corpus cannot turn this suite
    // green. The shape they record: the documentation teaches in fragments —
    // definitions without the `app` that would make them runnable — and only a
    // handful of blocks are whole programs.
    expect(ALL_BLOCKS.length).toBeGreaterThan(280);
    expect(kindOf("program").length).toBeGreaterThanOrEqual(6);
    expect(kindOf("invalid").length).toBeGreaterThanOrEqual(4);
    // `snippet` is the weakest assertion in the set, so the floor that matters
    // is on everything else: a block demoted to `snippet` to silence a failure
    // takes this count down with it.
    expect(kindOf("program").length + kindOf("fragment").length).toBeGreaterThanOrEqual(188);
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
      // "Not a complete program" is the whole of the claim, and it is what the
      // diagnostics answer: either there is no `app` (E0003) or the block
      // names definitions its surrounding prose supplies. A block that
      // compiles clean is a program wearing the wrong mark.
      else if (r.diagnostics.length === 0) {
        failures.push(`${at(b)} — marked fragment but compiles clean; drop the mark`);
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

  it("finds every invalid block rejected for a reason of its own", () => {
    // Judged with `requireApp: false`: a block that fails only because it has
    // no `app` is a fragment, and marking it invalid would let the diagnostic
    // it is supposed to demonstrate be deleted without this suite noticing.
    const failures = kindOf("invalid")
      .filter((b) => {
        const r = compileBlock(b, false);
        return r.ok && r.diagnostics.length === 0;
      })
      .map(
        (b) => `${at(b)} — marked invalid but compiles clean once the missing app is discounted`,
      );
    expect(failures).toEqual([]);
  });

  it("has no fence this suite would walk past", () => {
    // The collector matches at column 0. An indented fence is not collected,
    // and an uncollected block is an unchecked one — which is how the single
    // indented block in the spec stayed green while not parsing.
    const indented: string[] = [];
    for (const file of markdownFiles(docsRoot)) {
      const rel = relPath(file);
      for (const [i, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
        if (INDENTED_FENCE.test(line)) indented.push(`${rel}:${i + 1}`);
      }
    }
    expect(indented).toEqual([]);
  });

  it("uses `;` only as the separator the grammar says it is", () => {
    // `#` starts a comment and newline separates statements (language.md
    // §1.2.3); only inside a `do=` may `;` join two of them. So the tail after
    // a `;` has to look like a statement — a whitelist, because "prose" is not
    // a thing a regex can recognize: an earlier attempt exempted anything
    // containing a bracket or a colon, which let `; Option: default if None,
    // v if Some(v)` through.
    const STATEMENT = /:=|^(emit|let|if|for|when|match|stop-timer)\b/;
    const STRING = /"(?:[^"\\]|\\.)*"/g;
    const failures: string[] = [];
    for (const b of ALL_BLOCKS) {
      for (const [i, raw] of b.code.split("\n").entries()) {
        // Strings first (a `#` inside one is not a comment), then the comment.
        const code = raw.replace(STRING, '""').split("#")[0] ?? "";
        const tail = /;\s*(\S.*)$/.exec(code)?.[1]?.trim();
        if (tail && !STATEMENT.test(tail)) {
          failures.push(`${b.file}:${b.line + i} — "; ${tail.slice(0, 48)}" reads as a comment`);
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

// A prop can name a definition in a string literal: a tile's `motion: "Spin"`
// (style.md §4.9.1), and a link's `prefetch: "loadTodo"` (routing.md §3.8).
// That is a reference like any other, so `rename` rewrites it with the rest
// (ai-edit.md §9.2.2): the name between the quotes changes, the quotes stay,
// and the file still checks. A comment or another string literal that only
// shares the name is not a reference, and keeps its text.

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renameDef } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const features = join(here, "..", "examples", "features");
const EXAMPLE = join(features, "181-string-literal-refs.kumiki");
const MOTION = join(features, "30-motion.kumiki");

/** `Spin` as a motion, in a comment, and as the text a tile shows. */
const SHARED = `# Spin turns the badge; this comment only names it.
motion Spin = {keyframes: {from: {rotate: 0}, to: {rotate: 360}}}
tile App = box(text("Spin")) {motion: "Spin"}
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** The source without its `#` comment lines, which name the definitions in prose. */
function code(source: string): string {
  return source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}

function errorsOf(source: string): string[] {
  return check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);
}

describe("a definition named in a string literal", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-string-literal-refs-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function copy(from: string): string {
    const path = join(dir, "app.kumiki");
    copyFileSync(from, path);
    return path;
  }

  it("is renamed inside the quotes when it is a motion", { timeout: 30_000 }, () => {
    const path = copy(EXAMPLE);
    renameDef(path, "motion.Spin", "Whirl");
    const source = code(readFileSync(path, "utf8"));
    expect(source).toContain("motion Whirl = {");
    expect(source).toContain('tile Spinner = box(text("Loading")) {motion: "Whirl"}');
    expect(source).not.toMatch(/\bSpin\b/);
    expect(errorsOf(source)).toEqual([]);
  });

  it("is renamed inside the quotes when it is a link's prefetch", { timeout: 30_000 }, () => {
    const path = copy(EXAMPLE);
    renameDef(path, "reducer.loadTodo", "fetchTodo");
    const source = code(readFileSync(path, "utf8"));
    expect(source).toContain("reducer fetchTodo");
    expect(source).toContain('prefetch: "fetchTodo",');
    expect(source).not.toContain("loadTodo");
    expect(errorsOf(source)).toEqual([]);
  });

  it("does not stop the motion example's spinner from being renamed", { timeout: 30_000 }, () => {
    const path = copy(MOTION);
    renameDef(path, "motion.Spin", "Whirl");
    const source = code(readFileSync(path, "utf8"));
    expect(source).toContain('tile Spinner  = box(text("Loading")) {motion: "Whirl"}');
    expect(source).toContain('{motion: "SlideIn", pad: "lg", gap: "md"}');
    expect(source).not.toMatch(/\bSpin\b/);
    expect(errorsOf(source)).toEqual([]);
  });

  it("leaves a comment and another string literal that share the name alone", {
    timeout: 30_000,
  }, () => {
    const path = join(dir, "app.kumiki");
    writeFileSync(path, SHARED);
    renameDef(path, "motion.Spin", "Whirl");
    const source = readFileSync(path, "utf8");
    expect(source).toContain("# Spin turns the badge; this comment only names it.");
    expect(source).toContain("motion Whirl = {");
    expect(source).toContain('tile App = box(text("Spin")) {motion: "Whirl"}');
    expect(errorsOf(source)).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { renameDef } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { APP_A, seed, seedCopy } from "./helpers/files.ts";

const EXAMPLE = feature("181-string-literal-refs");
const MOTION = feature("30-motion");

const SHARED = `# Spin turns the badge; this comment only names it.
motion Spin = {keyframes: {from: {rotate: 0}, to: {rotate: 360}}}
tile App = box(text("Spin")) {motion: "Spin"}
${APP_A}`;

// The examples' header comments name the definitions in prose, which rename leaves alone.
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

function renamed(file: string, qname: string, to: string): string {
  renameDef(file, qname, to);
  return readFileSync(file, "utf8");
}

describe("a definition named in a string literal", () => {
  it("is renamed inside the quotes when it is a motion", { timeout: 30_000 }, () => {
    const source = code(renamed(seedCopy(EXAMPLE), "motion.Spin", "Whirl"));
    expect(source).toContain("motion Whirl = {");
    expect(source).toContain('tile Spinner = box(text("Loading")) {motion: "Whirl"}');
    expect(source).not.toMatch(/\bSpin\b/);
    expect(errorsOf(source)).toEqual([]);
  });

  it("is renamed inside the quotes when it is a link's prefetch", { timeout: 30_000 }, () => {
    const source = code(renamed(seedCopy(EXAMPLE), "reducer.loadTodo", "fetchTodo"));
    expect(source).toContain("reducer fetchTodo");
    expect(source).toContain('prefetch: "fetchTodo",');
    expect(source).not.toContain("loadTodo");
    expect(errorsOf(source)).toEqual([]);
  });

  it("does not stop the motion example's spinner from being renamed", { timeout: 30_000 }, () => {
    const source = code(renamed(seedCopy(MOTION), "motion.Spin", "Whirl"));
    expect(source).toContain('tile Spinner  = box(text("Loading")) {motion: "Whirl"}');
    expect(source).toContain('{motion: "SlideIn", pad: "lg", gap: "md"}');
    expect(source).not.toMatch(/\bSpin\b/);
    expect(errorsOf(source)).toEqual([]);
  });

  it("leaves a comment and another string literal that share the name alone", {
    timeout: 30_000,
  }, () => {
    const source = renamed(seed(SHARED), "motion.Spin", "Whirl");
    expect(source).toContain("# Spin turns the badge; this comment only names it.");
    expect(source).toContain("motion Whirl = {");
    expect(source).toContain('tile App = box(text("Spin")) {motion: "Whirl"}');
    expect(errorsOf(source)).toEqual([]);
  });
});

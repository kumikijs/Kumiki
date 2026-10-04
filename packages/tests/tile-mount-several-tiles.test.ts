// lifecycle.md §7.1.6 says how to run reducers on the mount of several tiles:
// one reducer per tile, each under its own name, because a reducer name is
// declared once (errors.md E0007). The section carries a runnable program for
// it, and that program, taken from both language tracks, is what these tests
// hold to the section's text:
//
//   - mounting it runs each tile's reducer once, in the order they are written;
//   - which tile's reducer runs first follows the rendered tree, so the same
//     reducers written the other way round run in the same order;
//   - a second reducer on one tile runs after the first, in definition order;
//   - giving two of the reducers one name is E0007, at the second declaration.
//
// spec-blocks.test.ts already compiles every complete program in docs/; what
// it does not do is mount one and watch which reducers run.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, type Def, lex, parse, type ReducerDef } from "@kumikijs/compiler";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { loadSource } from "./helpers/load.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TRACKS = [
  ["en", join(repoRoot, "docs", "spec", "lifecycle.md")],
  ["ja", join(repoRoot, "docs", "ja", "spec", "lifecycle.md")],
] as const;

const HEADING = "### 7.1.6 ";

/**
 * The one complete program in §7.1.6: the body of its unmarked ```kumiki
 * fence, the mark spec-blocks.test.ts reads as "parses and checks clean".
 * The section runs to the next heading of its level or above; a `#` line
 * inside a fence is a Kumiki comment, not a heading.
 */
function sectionProgram(file: string): string {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(HEADING));
  if (start === -1) throw new Error(`${file} has no "${HEADING}" heading`);
  const programs: string[] = [];
  let body: string[] | null = null;
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (!fenced && /^#{1,3} /.test(line)) break;
    if (line.startsWith("```")) {
      if (fenced && body) programs.push(body.join("\n"));
      body = !fenced && line === "```kumiki" ? [] : null;
      fenced = !fenced;
      continue;
    }
    body?.push(line);
  }
  if (programs.length !== 1) {
    throw new Error(`§7.1.6 of ${file} holds ${programs.length} complete programs, not one`);
  }
  return defined(programs[0], "§7.1.6's program");
}

const isMountReducer = (d: Def): d is ReducerDef =>
  d.kind === "ReducerDef" &&
  d.on.kind === "LifecycleEvent" &&
  d.on.tileTarget?.event === "tile.mount";

function mountReducers(src: string): ReducerDef[] {
  return parse(lex(src)).defs.filter(isMountReducer);
}

const namesOf = (rs: ReducerDef[]): string[] => rs.map((r) => r.name);

/** The tile a `tile.mount(X)` reducer names. */
function targetOf(r: ReducerDef): string {
  if (r.on.kind !== "LifecycleEvent" || !r.on.tileTarget) {
    throw new Error(`reducer "${r.name}" is not a tile.mount reducer`);
  }
  return r.on.tileTarget.name;
}

type Piece = { def: Def; lines: string[] };
type MountPiece = { def: ReducerDef; lines: string[] };

const isMountPiece = (p: Piece): p is MountPiece => isMountReducer(p.def);

/**
 * A program cut into its definitions, and the lines ahead of the first. A
 * definition runs from its own first line to the next one's, so one spread
 * over several lines moves as one piece.
 */
function split(src: string): { head: string[]; pieces: Piece[] } {
  const lines = src.split("\n");
  const defs = parse(lex(src)).defs;
  const start = (d: Def | undefined): number => (d ? d.pos.line - 1 : lines.length);
  const pieces = defs.map((def, i) => ({
    def,
    lines: lines.slice(start(def), start(defs[i + 1])),
  }));
  if (pieces.some((p) => p.lines.length === 0)) {
    throw new Error("§7.1.6's program has two definitions on one line");
  }
  return { head: lines.slice(0, start(defs[0])), pieces };
}

/** Pieces put back together, a blank line after each so a moved one never runs into the next. */
const joined = (head: string[], pieces: string[][]): string =>
  [...head, ...pieces.flatMap((lines) => [...lines, ""])].join("\n");

/** The `tile.mount` reducers' pieces, at least two of them. */
function mountPieces(pieces: Piece[]): [MountPiece, MountPiece, ...MountPiece[]] {
  const [first, second, ...rest] = pieces.filter(isMountPiece);
  if (!first || !second) throw new Error("§7.1.6's program has fewer than two tile.mount reducers");
  return [first, second, ...rest];
}

/** A reducer's piece with the reducer renamed `to`, on the line that declares it. */
function renamed(piece: MountPiece, to: string): string[] {
  const [line = "", ...rest] = piece.lines;
  const declaration = new RegExp(`^reducer(\\s+)${piece.def.name}\\b`);
  if (!declaration.test(line)) throw new Error(`"${line}" does not declare ${piece.def.name}`);
  return [line.replace(declaration, `reducer$1${to}`), ...rest];
}

/** The `tile.mount` reducers that ran while `src` mounted, in the order they ran. */
async function mountedRun(src: string): Promise<string[]> {
  const names = new Set(namesOf(mountReducers(src)));
  const app = await loadSource(src);
  const logger = createEpisodeLogger({ memoryMax: 100 });
  window.history.replaceState(null, "", "/");
  const root = document.createElement("div");
  document.body.appendChild(root);
  const { dispose } = mount(app, root, { episodeLogger: logger });
  try {
    return logger
      .list()
      .flatMap((ep) => ep.steps)
      .flatMap((s) => (s.kind === "reducer" && names.has(s.name) ? [s.name] : []));
  } finally {
    dispose();
    root.remove();
  }
}

const errorsOf = (src: string): { code: string; line: number }[] =>
  check(parse(lex(src)), { capabilities: [] })
    .filter((d) => d.severity !== "warning")
    .map((d) => ({ code: d.code, line: d.pos.line }));

describe.each(TRACKS)("lifecycle.md §7.1.6 (%s): one reducer per tile", (_track, file) => {
  it("declares a tile.mount reducer under its own name for each of several tiles", () => {
    const src = sectionProgram(file);
    const reducers = mountReducers(src);
    expect(new Set(reducers.map(targetOf)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(namesOf(reducers)).size).toBe(reducers.length);
    expect(errorsOf(src)).toEqual([]);
  });

  it("runs each tile's reducer once on mount, in the order they are written", async () => {
    const src = sectionProgram(file);
    expect(await mountedRun(src)).toEqual(namesOf(mountReducers(src)));
  });

  it("runs them in the same order when they are written the other way round", async () => {
    const src = sectionProgram(file);
    const { head, pieces } = split(src);
    const backwards = mountPieces(pieces).reverse();
    const reversed = joined(
      head,
      pieces.map((p) => (isMountPiece(p) ? defined(backwards.shift(), "a reducer") : p).lines),
    );
    // The rewrite has to have changed the definition order, or the equality
    // below says nothing about it.
    expect(namesOf(mountReducers(reversed))).toEqual(namesOf(mountReducers(src)).reverse());
    expect(errorsOf(reversed)).toEqual([]);
    expect(await mountedRun(reversed)).toEqual(await mountedRun(src));
  });

  it("runs a second reducer on one tile after the first, as they are written", async () => {
    const src = sectionProgram(file);
    const { head, pieces } = split(src);
    const [first] = mountPieces(pieces);
    const again = `${first.def.name}Again`;
    // Written last, behind every other reducer: the tree still runs it before
    // the reducers of the tiles after its own, and definition order runs it
    // after every reducer already on its tile.
    const program = joined(head, [...pieces.map((p) => p.lines), renamed(first, again)]);
    const written = mountReducers(src);
    const onItsTile = written.filter((r) => targetOf(r) === targetOf(first.def));
    const behind = defined(onItsTile.at(-1), "a reducer on the copied tile").name;
    expect(errorsOf(program)).toEqual([]);
    expect(await mountedRun(program)).toEqual(
      namesOf(written).flatMap((n) => (n === behind ? [n, again] : [n])),
    );
  });

  it("is E0007 at the second reducer when two share one name", () => {
    const src = sectionProgram(file);
    const { head, pieces } = split(src);
    const [first, second] = mountPieces(pieces);
    const program = joined(
      head,
      pieces.map((p) => (p === second ? renamed(second, first.def.name) : p.lines)),
    );
    const declared = defined(mountReducers(program)[1], "the renamed reducer");
    expect(errorsOf(program)).toEqual([{ code: "E0007", line: declared.pos.line }]);
  });
});

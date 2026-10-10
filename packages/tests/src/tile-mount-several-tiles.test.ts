import { readFileSync } from "node:fs";
import { check, type Def, lex, parse, type ReducerDef } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const SOURCE = readFileSync(feature("210-tile-mount-several-tiles"), "utf8");

const isMountReducer = (d: Def): d is ReducerDef =>
  d.kind === "ReducerDef" &&
  d.on.kind === "LifecycleEvent" &&
  d.on.tileTarget?.event === "tile.mount";

function mountReducers(src: string): ReducerDef[] {
  return parse(lex(src)).defs.filter(isMountReducer);
}

const namesOf = (rs: ReducerDef[]): string[] => rs.map((r) => r.name);

function targetOf(r: ReducerDef): string {
  if (r.on.kind !== "LifecycleEvent" || !r.on.tileTarget) {
    throw new Error(`reducer "${r.name}" is not a tile.mount reducer`);
  }
  return r.on.tileTarget.name;
}

type Piece = { def: Def; lines: string[] };
type MountPiece = { def: ReducerDef; lines: string[] };

const isMountPiece = (p: Piece): p is MountPiece => isMountReducer(p.def);

/** A definition spread over several lines moves as one piece. */
function split(src: string): { head: string[]; pieces: Piece[] } {
  const lines = src.split("\n");
  const defs = parse(lex(src)).defs;
  const start = (d: Def | undefined): number => (d ? d.pos.line - 1 : lines.length);
  const pieces = defs.map((def, i) => ({
    def,
    lines: lines.slice(start(def), start(defs[i + 1])),
  }));
  if (pieces.some((p) => p.lines.length === 0)) {
    throw new Error("the program has two definitions on one line");
  }
  return { head: lines.slice(0, start(defs[0])), pieces };
}

/** A blank line after each piece, so a moved one never runs into the next. */
const joined = (head: string[], pieces: string[][]): string =>
  [...head, ...pieces.flatMap((lines) => [...lines, ""])].join("\n");

function mountPieces(pieces: Piece[]): [MountPiece, MountPiece, ...MountPiece[]] {
  const [first, second, ...rest] = pieces.filter(isMountPiece);
  if (!first || !second) throw new Error("the program has fewer than two tile.mount reducers");
  return [first, second, ...rest];
}

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
  return withRoot(async (root) => {
    const { dispose } = mount(app, root, { episodeLogger: logger });
    try {
      return logger
        .list()
        .flatMap((ep) => ep.steps)
        .flatMap((s) => (s.kind === "reducer" && names.has(s.name) ? [s.name] : []));
    } finally {
      dispose();
    }
  });
}

const errorsOf = (src: string): { code: string; line: number }[] =>
  check(parse(lex(src)), { capabilities: [] })
    .filter((d) => d.severity !== "warning")
    .map((d) => ({ code: d.code, line: d.pos.line }));

describe("tile.mount on several tiles: one reducer per tile", () => {
  it("declares a tile.mount reducer under its own name for each of several tiles", () => {
    const reducers = mountReducers(SOURCE);
    expect(new Set(reducers.map(targetOf)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(namesOf(reducers)).size).toBe(reducers.length);
    expect(errorsOf(SOURCE)).toEqual([]);
  });

  it("runs each tile's reducer once on mount, in the order they are written", async () => {
    expect(await mountedRun(SOURCE)).toEqual(namesOf(mountReducers(SOURCE)));
  });

  it("runs them in the same order when they are written the other way round", async () => {
    const { head, pieces } = split(SOURCE);
    const backwards = mountPieces(pieces).reverse();
    const reversed = joined(
      head,
      pieces.map((p) => (isMountPiece(p) ? defined(backwards.shift(), "a reducer") : p).lines),
    );
    // Without a changed definition order, the equality below says nothing about it.
    expect(namesOf(mountReducers(reversed))).toEqual(namesOf(mountReducers(SOURCE)).reverse());
    expect(errorsOf(reversed)).toEqual([]);
    expect(await mountedRun(reversed)).toEqual(await mountedRun(SOURCE));
  });

  it("runs a second reducer on one tile after the first, as they are written", async () => {
    const { head, pieces } = split(SOURCE);
    const [first] = mountPieces(pieces);
    const again = `${first.def.name}Again`;
    const program = joined(head, [...pieces.map((p) => p.lines), renamed(first, again)]);
    const written = mountReducers(SOURCE);
    const onItsTile = written.filter((r) => targetOf(r) === targetOf(first.def));
    const behind = defined(onItsTile.at(-1), "a reducer on the copied tile").name;
    expect(errorsOf(program)).toEqual([]);
    expect(await mountedRun(program)).toEqual(
      namesOf(written).flatMap((n) => (n === behind ? [n, again] : [n])),
    );
  });

  it("is E0007 at the second reducer when two share one name", () => {
    const { head, pieces } = split(SOURCE);
    const [first, second] = mountPieces(pieces);
    const program = joined(
      head,
      pieces.map((p) => (p === second ? renamed(second, first.def.name) : p.lines)),
    );
    const declared = defined(mountReducers(program)[1], "the renamed reducer");
    expect(errorsOf(program)).toEqual([{ code: "E0007", line: declared.pos.line }]);
  });
});

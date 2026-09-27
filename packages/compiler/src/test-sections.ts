import { levenshtein } from "@kumikijs/runtime/text-distance";
import { type Expr, isTileExpr, type TestDef, type TileExpr } from "./ast.ts";

/**
 * The section vocabulary of a test body, per test kind (spec §8.1.1).
 *
 * A test body is a schema, and its sections are read by name: the lowering asks
 * a `given` for `slots`, for `event`, for `mocks`, and an `expect` for what that
 * kind asserts. A name outside the set was dropped — nothing read it, and
 * nothing reported it — so the section the author wrote simply did not happen:
 *
 *     given  = {slot: {count: 41}, event: {type: ui.click, target: B}}
 *     expect = {slots: {count: 1}, effects: []}
 *
 * passes, because `count` starts at its declared default and the 41 is never
 * set. The test asserts the reducer against a state nobody chose.
 *
 * An empty part is one with no sections at all: a `tile-test`'s `expect` is a
 * tile expression, a `property-test` asserts through its `invariant` clause,
 * and an `episode-test`'s given is the log it loads. The type of a section name
 * is derived from this table (see `SectionName`), so neither
 * `codegen/emit-test.ts` nor the checker can name a section it does not list —
 * which is what keeps the two of them reading one vocabulary.
 *
 * The `satisfies` binds the keys to the AST's own kind union, so a kind here
 * that the parser cannot produce, and a kind the parser produces that is
 * missing here, are both compile errors.
 */
export const TEST_SECTIONS = {
  "reducer-test": {
    given: ["slots", "event", "mocks"],
    expect: ["slots", "effects", "panic"],
  },
  "tile-test": {
    given: ["slots", "in"],
    expect: [],
  },
  "property-test": {
    given: ["slots", "event"],
    expect: [],
  },
  "episode-test": {
    given: [],
    expect: ["slots-equal", "no-panics", "no-errors"],
  },
} as const satisfies Record<TestDef["testKind"], Record<TestPart, readonly string[]>>;

/** The two clauses whose value is a record of sections. */
export type TestPart = "given" | "expect";

export type TestKind = keyof typeof TEST_SECTIONS;

/**
 * The sections `part` accepts, across every kind in `K` — `never` for a part
 * that has none. Distributed over `K` rather than indexed by it, so a caller
 * holding a union of kinds (the checker, walking a `given` for whatever kind
 * the test is) gets the union of their sections rather than `never`.
 */
export type SectionName<K extends TestKind, P extends TestPart> = {
  [KK in K]: (typeof TEST_SECTIONS)[KK][P][number];
}[K];

/** The sections a kind's `given` accepts. */
export type GivenSection<K extends TestKind> = SectionName<K, "given">;

/** The sections a kind's `expect` accepts. */
export type ExpectSection<K extends TestKind> = SectionName<K, "expect">;

/**
 * The positions of a test body whose value is read as a record of named parts,
 * and the shape each one takes. Every reader asks such a position for its
 * fields, and a value that is not a record literal has none — so a `given`
 * written as `setup` or `41` was read as empty and the setup never happened, an
 * `expect` asserted nothing, and a `mocks` scripted nothing, each without a
 * word. The checker reports E0713 at any of them that is not a record, and the
 * lowering throws the same sentence for a caller that skipped `check`.
 */
const RECORD_POSITIONS = {
  given: "{<section>: …}",
  expect: "{<section>: …}",
  mocks: "{<effect>: <policy>}",
  "given.mocks": "{<effect>: <outcome>}",
  "given.event": "{type: …, target: …}",
} as const;

export type RecordPosition = keyof typeof RECORD_POSITIONS;

/** What E0713 says about a record position holding something else. */
export function notARecordMessage(position: RecordPosition): string {
  return `\`${position}\` must be a record, \`${RECORD_POSITIONS[position]}\``;
}

/**
 * Whether `e` holds a value a record position can be read from. `{}` parses as
 * an empty map — nothing in it tells the two apart — and is the empty record
 * as written, so it counts as one.
 */
export function isRecordValue(e: Expr | TileExpr): boolean {
  if (isTileExpr(e)) return false;
  return e.kind === "RecordLit" || (e.kind === "MapLit" && e.entries.length === 0);
}

/**
 * The fields of the record written at `position`, none when nothing is written
 * there, and a throw when something that is not a record is.
 */
export function recordFieldsAt(
  e: Expr | TileExpr | undefined,
  position: RecordPosition,
): (Expr & { kind: "RecordLit" })["fields"] {
  if (e === undefined) return [];
  if (!isRecordValue(e)) throw new Error(`E0713 ${notARecordMessage(position)}`);
  return !isTileExpr(e) && e.kind === "RecordLit" ? e.fields : [];
}

/** The names a kind's part accepts, in the order the table lists them. */
export function sectionNames<K extends TestKind, P extends TestPart>(
  kind: K,
  part: P,
): readonly SectionName<K, P>[] {
  return TEST_SECTIONS[kind][part];
}

/**
 * Whether `written` names a section of `kind`'s `part`. A type predicate rather
 * than a lookup returning the name, because the answer is the narrowing: a
 * caller that has asked this question can then dispatch on the name with the
 * compiler checking the arms, which is the whole point of the table.
 */
export function isSectionName<K extends TestKind, P extends TestPart>(
  kind: K,
  part: P,
  written: string,
): written is SectionName<K, P> {
  const names: readonly string[] = TEST_SECTIONS[kind][part];
  return names.includes(written);
}

/**
 * The value of one section of a test's `given`, or `undefined` when the test
 * does not write it. `kind` is passed rather than read off `t` because
 * `TestDef` is not discriminated by it: passing the literal is what ties the
 * `name` argument to the table, so a section this file does not list is a type
 * error at the call site rather than a silent `undefined` at run time.
 *
 * A `given` that is written but is not a record throws (E0713) rather than
 * answering `undefined`, which is the silent empty record this replaced. The
 * lowering runs only on checked programs, so the throw is for a caller that
 * skipped `check`; a checker-side caller, which does see such a program, must
 * guard with `isRecordValue` first.
 */
export function givenSection<K extends TestKind>(
  t: TestDef,
  kind: K,
  name: GivenSection<K>,
): Expr | undefined {
  return recordFieldsAt(t.given, "given").find((f) => f.name === name)?.value;
}

/**
 * The value of one section of a test's `expect`. See `givenSection`, including
 * the throw on an `expect` that is written but is not a record.
 */
export function expectSection<K extends TestKind>(
  t: TestDef,
  kind: K,
  name: ExpectSection<K>,
): Expr | undefined {
  return recordFieldsAt(t.expect, "expect").find((f) => f.name === name)?.value;
}

/**
 * The accepted name `written` most likely meant, or `undefined` when it is
 * close to none of them — a suggestion that is not the word the author meant
 * sends the repair at the wrong name.
 *
 * A candidate qualifies at 2 edits or fewer, or at no more than
 * `ceil(written.length / 4)`, or on being an abbreviation of one at least three
 * characters long: `slots-eq` is three edits from `slots-equal`, which no
 * distance rule this tight reaches. The length floor is what keeps the
 * two-character `in` from claiming every `tile-test` key that happens to start
 * with it — `initial` means `slots`, and a rule without the floor answers `in`.
 *
 * A tie answers nothing. `no` is equidistant from `no-panics` and `no-errors`,
 * and picking whichever the table lists first is a coin flip dressed as an
 * answer; the diagnostic prints the accepted set either way.
 */
export function nearestSection(
  kind: TestKind,
  part: TestPart,
  written: string,
): string | undefined {
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const name of sectionNames(kind, part)) {
    const d = levenshtein(written, name);
    const abbreviates = name.length >= 3 && (name.startsWith(written) || written.startsWith(name));
    if (!abbreviates && d > 2 && d > Math.ceil(written.length / 4)) continue;
    if (d < bestScore) {
      bestScore = d;
      best = name;
      tied = false;
    } else if (d === bestScore) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

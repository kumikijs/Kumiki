import { levenshtein } from "@kumikijs/runtime/text-distance";
import { type Expr, isTileExpr, type Pos, type TestDef, type TileExpr } from "./ast.ts";

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

export type SectionName<K extends TestKind, P extends TestPart> = {
  [KK in K]: (typeof TEST_SECTIONS)[KK][P][number];
}[K];

/** The sections a kind's `given` accepts. */
export type GivenSection<K extends TestKind> = SectionName<K, "given">;

/** The sections a kind's `expect` accepts. */
export type ExpectSection<K extends TestKind> = SectionName<K, "expect">;

const RECORD_POSITIONS = {
  given: { shape: "{<section>: …}" },
  expect: { shape: "{<section>: …}" },
  mocks: { shape: "{<effect>: <policy>}" },
  "given.mocks": { shape: "{<effect>: <outcome>}" },
  "given.event": { shape: "{type: …, target: …}" },
  "given.slots": { shape: "{<slot>: …}" },
  "expect.slots": { shape: "{<slot>: …}" },
  // `from-log` takes the log's own final values as the expectation.
  "expect.slots-equal": { shape: "{<slot>: …}", or: "from-log" },
} as const satisfies Record<string, { shape: string; or?: string }>;

export type RecordPosition = keyof typeof RECORD_POSITIONS;

/** The bare names the table accepts in place of a record. */
export type BareName = Extract<(typeof RECORD_POSITIONS)[RecordPosition], { or: string }>["or"];

export function positionSpec<P extends RecordPosition>(position: P): (typeof RECORD_POSITIONS)[P] {
  return RECORD_POSITIONS[position];
}

/** What E0713 says about a record position holding something else. */
export function notARecordMessage(position: RecordPosition): string {
  const spec = positionSpec(position);
  const or = "or" in spec ? `, or \`${spec.or}\`` : "";
  return `\`${position}\` must be a record, \`${spec.shape}\`${or}`;
}

export function isRecordValue(e: Expr | TileExpr): boolean {
  if (isTileExpr(e)) return false;
  return e.kind === "RecordLit" || (e.kind === "MapLit" && e.entries.length === 0);
}

export function bareNameAt(e: Expr | TileExpr, position: RecordPosition): BareName | undefined {
  const spec = positionSpec(position);
  if (!("or" in spec) || isTileExpr(e) || e.kind !== "Ref" || e.name !== spec.or) return undefined;
  return spec.or;
}

/** Whether `e` is what `position` accepts: a record, or its one bare name. */
export function fitsRecordPosition(e: Expr | TileExpr, position: RecordPosition): boolean {
  return isRecordValue(e) || bareNameAt(e, position) !== undefined;
}

export function recordValueAt(e: Expr, position: RecordPosition): Expr {
  if (!fitsRecordPosition(e, position)) throw new Error(`E0713 ${notARecordMessage(position)}`);
  return e;
}

export function recordFieldsAt(
  e: Expr | TileExpr | undefined,
  position: RecordPosition,
): (Expr & { kind: "RecordLit" })["fields"] {
  if (e === undefined) return [];
  if (!fitsRecordPosition(e, position)) throw new Error(`E0713 ${notARecordMessage(position)}`);
  return !isTileExpr(e) && e.kind === "RecordLit" ? e.fields : [];
}

/** The names a kind's part accepts, in the order the table lists them. */
export function sectionNames<K extends TestKind, P extends TestPart>(
  kind: K,
  part: P,
): readonly SectionName<K, P>[] {
  return TEST_SECTIONS[kind][part];
}

export function isSectionName<K extends TestKind, P extends TestPart>(
  kind: K,
  part: P,
  written: string,
): written is SectionName<K, P> {
  const names: readonly string[] = TEST_SECTIONS[kind][part];
  return names.includes(written);
}

export type RecordField = (Expr & { kind: "RecordLit" })["fields"][number];

export function recordFieldsOf(e: Expr | TileExpr | undefined): RecordField[] {
  if (e === undefined || isTileExpr(e) || e.kind !== "RecordLit") return [];
  return e.fields;
}

/**
 * The sections of a test's `given` / `expect` that `kind` has, at the top of the part only. The
 * checker and the reference walk both read a test body through this, so they read the same names.
 */
export function testSections<K extends TestKind, P extends TestPart>(
  t: TestDef,
  kind: K,
  part: P,
  unknown?: (field: RecordField) => void,
): { section: SectionName<K, P>; value: Expr }[] {
  const out: { section: SectionName<K, P>; value: Expr }[] = [];
  for (const f of recordFieldsOf(part === "given" ? t.given : t.expect)) {
    if (isSectionName(kind, part, f.name)) out.push({ section: f.name, value: f.value });
    else unknown?.(f);
  }
  return out;
}

/**
 * A `given.event`'s tile and payload. `type` is the trigger grammar's, not an expression; `target`
 * names a tile only on a `ui.*` event, since a timer or effect-driven reducer is aimed at none.
 */
export function eventParts(event: Expr): {
  tile: { name: string; pos: Pos } | undefined;
  payload: RecordField[];
} {
  const fields = recordFieldsOf(event);
  const aimed = isUiEventType(fields.find((f) => f.name === "type")?.value);
  const target = aimed ? fields.find((f) => f.name === "target")?.value : undefined;
  return {
    // A capitalised tile name parses as a `Variant`, a lowercase one as a `Ref`.
    tile:
      target?.kind === "Variant" || target?.kind === "Ref"
        ? { name: target.name, pos: target.pos }
        : undefined,
    payload: fields.filter((f) => f.name !== "type" && f.name !== "target"),
  };
}

function isUiEventType(type: Expr | undefined): boolean {
  if (type === undefined) return false;
  // `ui.click` parses as a field read on the name `ui`.
  if (type.kind === "FieldAccess") return type.base.kind === "Ref" && type.base.name === "ui";
  return false;
}

export function givenSection<K extends TestKind>(
  t: TestDef,
  name: GivenSection<K>,
): Expr | undefined {
  return recordFieldsAt(t.given, "given").find((f) => f.name === name)?.value;
}

export function expectSection<K extends TestKind>(
  t: TestDef,
  name: ExpectSection<K>,
): Expr | undefined {
  return recordFieldsAt(t.expect, "expect").find((f) => f.name === name)?.value;
}

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

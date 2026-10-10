import type { TestDef } from "@kumikijs/compiler";
import { LexError, lex } from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { directDeps, type Store } from "../store.ts";
import { escapeRegExp } from "../text.ts";
import { type AutoPatch, debugSkip, type PatchOrReason } from "./patch.ts";
import { tokenLength } from "./text-edit.ts";

type LineRange = [number, number];

/** The failing test's target definition and that target's direct dependencies, as line spans. */
type TestScope = { target: LineRange; deps: LineRange[] };

function decodeKumikiStringBody(raw: string): string | null {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const esc = raw[++i];
    if (esc === "n") out += "\n";
    else if (esc === "t") out += "\t";
    else if (esc === "r") out += "\r";
    else if (esc === '"') out += '"';
    else if (esc === "\\") out += "\\";
    else return null;
  }
  return out;
}

/** `s` as a Kumiki string literal; null for a control character the language cannot escape. */
function kumikiStringLit(s: string): string | null {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (code < 0x20) return null;
    else out += ch;
  }
  return `${out}"`;
}

function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) if (source[i] === "\n") line++;
  return line;
}

/** The middles of `a` and `b` once their common prefix and suffix are cut off. */
function affixDiff(a: string, b: string): { midA: string; midE: string } {
  let p = 0;
  const minLen = Math.min(a.length, b.length);
  while (p < minLen && a[p] === b[p]) p++;
  let s = 0;
  while (s < minLen - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { midA: a.slice(p, a.length - s), midE: b.slice(p, b.length - s) };
}

export function testBodyLineRanges(store: Store): LineRange[] {
  return store.defs
    .filter((e) => e.def.kind === "TestDef")
    .map((e): LineRange => [e.range.startLine, e.range.endLine]);
}

function testKindOf(store: Store, testName: string): TestDef["testKind"] | undefined {
  const entry = store.defs.find((e) => e.def.kind === "TestDef" && e.name === testName);
  return entry ? (entry.def as TestDef).testKind : undefined;
}

function scopeOfTest(store: Store, testName: string): TestScope | null {
  const testEntry = store.defs.find((e) => e.def.kind === "TestDef" && e.name === testName);
  if (!testEntry) return null;
  const td = testEntry.def as TestDef;
  if (!td.target) return null;
  let targetQname: string;
  switch (td.testKind) {
    case "tile-test":
      targetQname = `tile.${td.target}`;
      break;
    case "reducer-test":
      targetQname = `reducer.${td.target}`;
      break;
    default:
      return null;
  }
  const target = store.byQName.get(targetQname);
  if (!target) return null;
  const deps: LineRange[] = [];
  for (const dq of directDeps(store, targetQname)) {
    const dep = store.byQName.get(dq);
    if (dep) deps.push([dep.range.startLine, dep.range.endLine]);
  }
  return { target: [target.range.startLine, target.range.endLine], deps };
}

function reducersWritingSlot(
  store: Store,
  slotName: string,
): Array<{ range: LineRange; body: string; name: string }> {
  const out: Array<{ range: LineRange; body: string; name: string }> = [];
  const assignRe = new RegExp(`\\b${escapeRegExp(slotName)}\\s*:=`);
  for (const e of store.defs) {
    if (e.def.kind !== "ReducerDef") continue;
    const body = store.lines.slice(e.range.startLine - 1, e.range.endLine).join("\n");
    if (assignRe.test(body))
      out.push({ range: [e.range.startLine, e.range.endLine], name: e.name, body });
  }
  return out;
}

/**
 * Plans one source edit that turns a failing test's actual leaf into the expected one:
 * the exact literal first, then a substring of a string literal, then a reducer's arithmetic.
 */
export function planTestPatchExplained(
  source: string,
  r: TestResult,
  excludedLineRanges: LineRange[] = [],
  store?: Store,
): PatchOrReason {
  const bail = (reason: string): { patch: null; reason: string } => {
    debugSkip("planTestPatch", reason, r.name);
    return { patch: null, reason };
  };
  if (r.pass || !r.leaf) return bail("test-passes-or-no-leaf");
  const { expected, actual } = r.leaf;
  if (actual === expected) return bail("leaf-equal-no-diff");
  const at = r.diffAt ?? "(leaf)";
  const inExcluded = (offset: number): boolean => {
    const line = lineOfOffset(source, offset);
    return excludedLineRanges.some(([lo, hi]) => line >= lo && line <= hi);
  };
  const scope = store ? scopeOfTest(store, r.name) : null;
  if (store && typeof actual !== "string" && testKindOf(store, r.name) === "tile-test") {
    return bail("tile-leaf-not-text");
  }

  const exact = planExactLiteralPatch(source, r, actual, expected, at, inExcluded, scope);
  if (exact.patch) return exact;

  let partialReason: string | null = null;
  if (typeof actual === "string" && typeof expected === "string") {
    const partial = planPartialStringPatch(source, r, actual, expected, at, inExcluded, scope);
    if (partial.patch) return partial;
    partialReason = partial.reason;
  }

  let arithReason: string | null = null;
  if (
    store &&
    typeof actual === "number" &&
    typeof expected === "number" &&
    typeof r.diffAt === "string" &&
    r.diffAt.startsWith("slots.")
  ) {
    const slotName = r.diffAt.slice("slots.".length);
    const arith = planArithmeticPatch(source, r, slotName, actual, expected, at, store, inExcluded);
    if (arith.patch) return arith;
    arithReason = arith.reason;
  }

  return bail(arithReason ?? partialReason ?? exact.reason);
}

export function planTestPatch(
  source: string,
  r: TestResult,
  excludedLineRanges: LineRange[] = [],
  store?: Store,
): AutoPatch | null {
  return planTestPatchExplained(source, r, excludedLineRanges, store).patch;
}

function leafLit(v: unknown): string | null {
  if (typeof v === "string") return kumikiStringLit(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/** The one occurrence of `needle` to edit: the only one, or the only one in the target, or in a dep. */
function pickScopedHit(
  source: string,
  needle: string,
  inExcluded: (offset: number) => boolean,
  scope: TestScope | null,
): number | null {
  const hits: number[] = [];
  for (let idx = source.indexOf(needle); idx !== -1; idx = source.indexOf(needle, idx + 1)) {
    if (!inExcluded(idx)) hits.push(idx);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  if (!scope) return null;
  const inRange = (offset: number, range: LineRange): boolean => {
    const line = lineOfOffset(source, offset);
    return line >= range[0] && line <= range[1];
  };
  const inTarget = hits.filter((h) => inRange(h, scope.target));
  if (inTarget.length === 1) return inTarget[0]!;
  if (inTarget.length > 1) return null;
  const inDeps = hits.filter((h) => scope.deps.some((r) => inRange(h, r)));
  if (inDeps.length === 1) return inDeps[0]!;
  return null;
}

export function iterStringLiterals(
  source: string,
): Array<{ start: number; end: number; body: string }> {
  const out: Array<{ start: number; end: number; body: string }> = [];
  const re = /"(?:[^"\\]|\\.)*"/g;
  let m: RegExpExecArray | null = re.exec(source);
  while (m !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({ start, end, body: m[0].slice(1, -1) });
    m = re.exec(source);
  }
  return out;
}

function tokenBounds(source: string): { starts: Set<number>; ends: Set<number> } | null {
  let tokens: ReturnType<typeof lex>;
  try {
    tokens = lex(source);
  } catch (e) {
    if (e instanceof LexError) return null;
    throw e;
  }
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const t of tokens) {
    if (t.kind === "eof") continue;
    const start = (lineStarts[t.pos.line - 1] ?? 0) + t.pos.col - 1;
    starts.add(start);
    ends.add(start + tokenLength(source, t, start));
  }
  return { starts, ends };
}

function planExactLiteralPatch(
  source: string,
  r: TestResult,
  actual: unknown,
  expected: unknown,
  at: string,
  inExcluded: (offset: number) => boolean,
  scope: TestScope | null,
): PatchOrReason {
  const actualLit = leafLit(actual);
  const expectedLit = leafLit(expected);
  if (actualLit === null || expectedLit === null)
    return { patch: null, reason: "leaf-not-a-kumiki-literal" };
  const bounds = tokenBounds(source);
  if (bounds === null) return { patch: null, reason: "source-does-not-lex" };
  const notWholeToken = (offset: number): boolean =>
    inExcluded(offset) || !bounds.starts.has(offset) || !bounds.ends.has(offset + actualLit.length);
  const hit = pickScopedHit(source, actualLit, notWholeToken, scope);
  if (hit === null) return { patch: null, reason: "no-scoped-literal-hit" };
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: `replace ${actualLit} with ${expectedLit} (from failing test "${r.name}" @ ${at})`,
      apply: (text: string) =>
        text.slice(0, hit) + expectedLit + text.slice(hit + actualLit.length),
      anchor: { kind: "region" },
    },
  };
}

function planPartialStringPatch(
  source: string,
  r: TestResult,
  actual: string,
  expected: string,
  at: string,
  inExcluded: (offset: number) => boolean,
  scope: TestScope | null,
): PatchOrReason {
  const { midA, midE } = affixDiff(actual, expected);
  if (midA.length === 0 || midE.length === 0) return { patch: null, reason: "affix-empty-middle" };
  const matches: Array<{ start: number; end: number; decoded: string }> = [];
  for (const lit of iterStringLiterals(source)) {
    if (inExcluded(lit.start)) continue;
    const decoded = decodeKumikiStringBody(lit.body);
    if (decoded === null) {
      const snippet = source.slice(lit.start, Math.min(lit.end, lit.start + 40));
      debugSkip("planPartialStringPatch", "decoder-returned-null", snippet);
      continue;
    }
    if (decoded.includes(midA)) matches.push({ start: lit.start, end: lit.end, decoded });
  }
  if (matches.length === 0) return { patch: null, reason: "no-string-literal-contains-mida" };
  const rank = (offset: number): number => {
    if (!scope) return 2;
    const line = lineOfOffset(source, offset);
    if (line >= scope.target[0] && line <= scope.target[1]) return 0;
    if (scope.deps.some(([lo, hi]) => line >= lo && line <= hi)) return 1;
    return 2;
  };
  const ranked = matches.map((mm) => ({ mm, rank: rank(mm.start) }));
  const minRank = Math.min(...ranked.map((x) => x.rank));
  const top = ranked.filter((x) => x.rank === minRank).map((x) => x.mm);
  if (top.length !== 1) return { patch: null, reason: "ambiguous-string-literal-match" };
  const target = top[0]!;
  const bodyIdx = target.decoded.indexOf(midA);
  if (bodyIdx < 0) return { patch: null, reason: "internal-body-not-found" };
  const patchedBody =
    target.decoded.slice(0, bodyIdx) + midE + target.decoded.slice(bodyIdx + midA.length);
  const patchedLit = kumikiStringLit(patchedBody);
  if (patchedLit === null) return { patch: null, reason: "patched-body-unspellable" };
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: `replace "${midA}" with "${midE}" inside "${target.decoded}" (from failing test "${r.name}" @ ${at})`,
      apply: (text: string) => text.slice(0, target.start) + patchedLit + text.slice(target.end),
      anchor: { kind: "region" },
    },
  };
}

/** Re-solves `slot := slot op N` in the one reducer writing the slot so it yields `expected`. */
function planArithmeticPatch(
  source: string,
  r: TestResult,
  slotName: string,
  actual: number,
  expected: number,
  at: string,
  store: Store,
  inExcluded: (offset: number) => boolean,
): PatchOrReason {
  const reducers = reducersWritingSlot(store, slotName);
  if (reducers.length !== 1) return { patch: null, reason: "ambiguous-reducer-set" };
  const red = reducers[0]!;
  const stmtRe = new RegExp(
    `\\b${escapeRegExp(slotName)}\\s*:=\\s*${escapeRegExp(slotName)}\\s*([+\\-*])\\s*(-?\\d+)\\b`,
  );
  const bodyMatch = stmtRe.exec(red.body);
  if (!bodyMatch) return { patch: null, reason: "no-additive-multiplicative-shape" };
  const op = bodyMatch[1] as "+" | "-" | "*";
  const n = Number.parseInt(bodyMatch[2]!, 10);
  if (!Number.isSafeInteger(n)) return { patch: null, reason: "non-safe-integer-operand" };
  let newLine: string;
  let newDesc: string;
  if (op === "+" || op === "-") {
    const delta = op === "+" ? n : -n;
    const base = actual - delta;
    const wantedDelta = expected - base;
    if (wantedDelta === 0) return { patch: null, reason: "additive-zero-delta" };
    const newOp = wantedDelta > 0 ? "+" : "-";
    const newN = Math.abs(wantedDelta);
    if (newOp === op && newN === n) return { patch: null, reason: "additive-noop-solution" };
    newLine = `${slotName} := ${slotName} ${newOp} ${newN}`;
    newDesc = `reducer "${red.name}": ${slotName} := ${slotName} ${op} ${n} → ${newLine}`;
  } else {
    if (n === 0 || actual === 0) return { patch: null, reason: "multiplicative-zero-guard" };
    const base = actual / n;
    if (!Number.isInteger(base) || base === 0)
      return { patch: null, reason: "multiplicative-nonintegral-base" };
    const newN = expected / base;
    if (!Number.isInteger(newN) || newN === n)
      return { patch: null, reason: "multiplicative-nonintegral-solution" };
    newLine = `${slotName} := ${slotName} * ${newN}`;
    newDesc = `reducer "${red.name}": ${slotName} := ${slotName} * ${n} → ${newLine}`;
  }
  const globalRe = new RegExp(stmtRe.source, "g");
  let sourceMatch: RegExpExecArray | null = null;
  let running: RegExpExecArray | null = globalRe.exec(source);
  while (running !== null) {
    const line = lineOfOffset(source, running.index);
    if (!inExcluded(running.index) && line >= red.range[0] && line <= red.range[1]) {
      sourceMatch = running;
      break;
    }
    running = globalRe.exec(source);
  }
  if (!sourceMatch) return { patch: null, reason: "arithmetic-splice-target-lost" };
  const start = sourceMatch.index;
  const end = start + sourceMatch[0].length;
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: newDesc,
      apply: (text: string) => text.slice(0, start) + newLine + text.slice(end),
      anchor: { kind: "region" },
    },
  };
}

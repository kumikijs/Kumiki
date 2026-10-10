import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { loadSource, type Store } from "../store.ts";
import { messageOf } from "../text.ts";
import { atomicWriteFileSync } from "../write-lock.ts";
import { lockViolation } from "./locks.ts";

/** The one order qualified names are listed in, in reports and in checks. */
export const compareQNames = (a: string, b: string): number => a.localeCompare(b);

function validate(
  path: string,
  before: string,
  src: string,
): { ok: true } | { ok: false; message: string } {
  try {
    const program = parse(lex(src));
    const errors = check(program, { requireApp: false }).filter((d) => d.severity !== "warning");
    if (errors.length > 0) {
      const summary = errors
        .slice(0, 3)
        .map((e) => `${e.code} ${e.message}`)
        .join("; ");
      return { ok: false, message: `Validation failed: ${summary}` };
    }
  } catch (e) {
    return { ok: false, message: `Parse/lex failed: ${String(e)}` };
  }
  const locked = touchedLockViolation(path, before, src);
  return locked === undefined ? { ok: true } : { ok: false, message: locked };
}

// Every write of a source asks this — the mutators through `validate`, and `fix` before it
// writes a repair — so a definition is held to its lock whichever way the write reached it.
export function touchedLockViolation(
  path: string,
  before: string,
  after: string,
): string | undefined {
  return lockViolation(path, touchedDefinitions(before, after));
}

function touchedDefinitions(before: string, after: string): string[] {
  const a = definitionTexts(before);
  const b = definitionTexts(after);
  const touched = new Set<string>();
  for (const [q, text] of a) if (b.get(q) !== text) touched.add(q);
  for (const q of b.keys()) if (!a.has(q)) touched.add(q);
  return [...touched].sort(compareQNames);
}

function definitionTexts(source: string): Map<string, string> {
  const out = new Map<string, string>();
  let store: Store;
  try {
    store = loadSource(source);
  } catch {
    return out;
  }
  for (const e of store.defs) {
    const q = `${e.layer}.${e.name}`;
    const text = store.lines.slice(e.range.startLine - 1, e.range.endLine).join("\n");
    // A name defined twice keeps both texts, so touching either one shows.
    const prior = out.get(q);
    out.set(q, prior === undefined ? text : `${prior}\n\0\n${text}`);
  }
  return out;
}

/** Validates `next`, writes it, then logs the op; a failed log restores the file. */
export function commit(path: string, next: string, verb: string, log: () => string): string {
  const before = readFileSync(path, "utf8");
  const v = validate(path, before, next);
  if (!v.ok) throw new Error(`${verb} rejected: ${v.message}`);
  atomicWriteFileSync(path, next);
  try {
    return log();
  } catch (e) {
    try {
      atomicWriteFileSync(path, before);
    } catch (r) {
      throw new Error(
        `${verb} failed: the op could not be logged (${messageOf(e)}), and restoring ${path} failed too (${messageOf(r)}); the file holds an edit the op log does not`,
        { cause: e },
      );
    }
    throw new Error(
      `${verb} rejected: the op could not be logged (${messageOf(e)}); the file was restored and nothing was written`,
      { cause: e },
    );
  }
}

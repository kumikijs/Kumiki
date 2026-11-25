import { readFileSync } from "node:fs";
import { check, lex, parse, severityOf } from "@kumikijs/compiler";
import { definitionText, loadSource, type Store } from "../store.ts";
import { messageOf } from "../text.ts";
import { atomicWriteFileSync } from "../write-lock.ts";
import { lockViolation } from "./locks.ts";
import { OpLogChanged } from "./op-log.ts";

/** The one order qualified names are listed in, in reports and in checks. */
export const compareQNames = (a: string, b: string): number => a.localeCompare(b);

function validate(
  path: string,
  before: string,
  src: string,
  only: string | undefined,
): { ok: true } | { ok: false; message: string } {
  let errors: ReturnType<typeof check>;
  try {
    const program = parse(lex(src));
    errors = check(program, { requireApp: false }).filter((d) => severityOf(d) === "error");
  } catch (e) {
    return { ok: false, message: `Parse/lex failed: ${String(e)}` };
  }
  const { changed, added } = definitionChanges(before, src);
  // Reported first: a definition the write changed by mistake is why the checker may now object.
  const others = changed.filter((q) => only !== undefined && q !== only);
  if (others.length > 0) {
    return { ok: false, message: `writing ${only} would change ${others.join(", ")} too` };
  }
  if (errors.length > 0) {
    const summary = errors
      .slice(0, 3)
      .map((e) => `${e.code} ${e.message}`)
      .join("; ");
    return { ok: false, message: `Validation failed: ${summary}` };
  }
  const locked = lockViolation(path, [...changed, ...added].sort(compareQNames));
  return locked === undefined ? { ok: true } : { ok: false, message: locked };
}

// Every edit of a source asks this under the write lock, just before it writes — the mutators
// through `validate`, `fix` in `writeFix` — so a definition is held to its lock whichever way the
// edit reached it. A write that puts the file back as it was before a failed op asks nothing.
export function touchedLockViolation(
  path: string,
  before: string,
  after: string,
): string | undefined {
  const { changed, added } = definitionChanges(before, after);
  return lockViolation(path, [...changed, ...added].sort(compareQNames));
}

/** The definitions of `before` that `after` holds otherwise or not at all, and those it adds. */
function definitionChanges(before: string, after: string): { changed: string[]; added: string[] } {
  const a = definitionTexts(before);
  const b = definitionTexts(after);
  return {
    changed: [...a].filter(([q, text]) => b.get(q) !== text).map(([q]) => q),
    added: [...b.keys()].filter((q) => !a.has(q)),
  };
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
    const text = definitionText(store, e);
    // A name defined twice keeps both texts, so touching either one shows.
    const prior = out.get(q);
    out.set(q, prior === undefined ? text : `${prior}\n\0\n${text}`);
  }
  return out;
}

/**
 * Validates `next`, writes it, then logs the op; a failed log restores the file. With `only`, a
 * `next` that changes any definition but that one is rejected.
 */
export function commit(
  path: string,
  next: string,
  verb: string,
  log: () => string,
  only?: string,
): string {
  const before = readFileSync(path, "utf8");
  const v = validate(path, before, next, only);
  if (!v.ok) throw new Error(`${verb} rejected: ${v.message}`);
  atomicWriteFileSync(path, next);
  try {
    return log();
  } catch (e) {
    const mayHoldOp = e instanceof OpLogChanged && e.mayHoldOp;
    try {
      atomicWriteFileSync(path, before);
    } catch (r) {
      throw new Error(
        `${verb} failed: the op could not be logged (${messageOf(e)}), and restoring ${path} failed too (${messageOf(r)}); ${mayHoldOp ? "the file holds this op's edit" : "the file holds an edit the op log does not"}`,
        { cause: e },
      );
    }
    if (e instanceof OpLogChanged) {
      throw new Error(
        `${verb} ${mayHoldOp ? "failed" : "rejected"}: the op could not be logged (${e.message}); the file was restored`,
        { cause: e },
      );
    }
    throw new Error(
      `${verb} rejected: the op could not be logged (${messageOf(e)}); the file was restored and nothing was written`,
      { cause: e },
    );
  }
}

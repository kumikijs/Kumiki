import type { PanicCategory, PanicCauseLink } from "../episode.ts";
import { NONE, type OptionOf, someOf } from "./types.ts";

export class KumikiPanic extends Error {
  readonly isKumikiPanic = true as const;
  location: string | undefined;
  constructor(message: string, location?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KumikiPanic";
    this.location = location;
  }
}

/** True for a KumikiPanic — also matches across realms where `instanceof` fails. */
export function isPanic(e: unknown): e is KumikiPanic {
  return (
    e instanceof KumikiPanic ||
    (typeof e === "object" &&
      e !== null &&
      (e as { isKumikiPanic?: boolean }).isKumikiPanic === true)
  );
}

/** Why the dispatcher could not run an emit, as the category its report carries. */
export type EmitRefusal = { category: "effect" } | { category: "capability"; cap: string };

export function reportRefusedEmit(
  effect: string,
  why: EmitRefusal,
): PanicRecord & { location: string } {
  const location = `effect "${effect}"`;
  const rec: PanicRecord & { location: string } = {
    message:
      why.category === "effect"
        ? `effect "${effect}" is not declared in app.effects`
        : `capability "${why.cap}" is not declared in app.caps`,
    location,
    stack: undefined,
    cause: undefined,
    category: why.category,
  };
  reportPanicRecord(location, rec, "panic");
  return rec;
}

export type PanicRecord = {
  message: string;
  location: string | undefined;
  stack: string | undefined;
  cause: PanicCauseLink[] | undefined;
  category: PanicCategory;
};

export function userPanicInfo(
  rec: PanicRecord,
  location: string,
  episodeId: string | undefined,
): {
  message: string;
  location: string;
  "episode-id": OptionOf<string>;
  cause: OptionOf<string>;
  category: PanicCategory;
} {
  const nearest = rec.cause?.[0]?.message;
  return {
    message: rec.message,
    location,
    "episode-id": episodeId === undefined ? NONE : someOf(episodeId),
    cause: nearest ? someOf(nearest) : NONE,
    category: rec.category,
  };
}

const PANIC_CAUSE_MAX_DEPTH = 8;

function safeErrorField(e: unknown, field: "message" | "stack"): string | undefined {
  try {
    const v = (e as Record<string, unknown> | null | undefined)?.[field];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

function safeString(v: unknown): string {
  try {
    return String(v);
  } catch {
    return "<unstringifiable>";
  }
}

function safeCauseOf(e: unknown): unknown {
  try {
    return (e as { cause?: unknown } | null | undefined)?.cause;
  } catch {
    return undefined;
  }
}

function collectCauseChain(root: unknown): PanicCauseLink[] {
  const chain: PanicCauseLink[] = [];
  const seen = new Set<unknown>();
  if (root !== null && (typeof root === "object" || typeof root === "function")) seen.add(root);
  let cur: unknown = safeCauseOf(root);
  while (cur !== undefined && cur !== null && chain.length < PANIC_CAUSE_MAX_DEPTH) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const link: PanicCauseLink = { message: "" };
    try {
      if (cur instanceof Error) {
        link.message = safeErrorField(cur, "message") ?? "";
        const stack = safeErrorField(cur, "stack");
        if (stack !== undefined) link.stack = stack;
      } else {
        link.message = safeString(cur);
      }
    } catch {
      link.message = "<cause unavailable>";
    }
    chain.push(link);
    cur = cur instanceof Error ? safeCauseOf(cur) : undefined;
  }
  return chain;
}

export function panicInfo(e: unknown, category: PanicCategory = "unknown"): PanicRecord {
  try {
    const cause = collectCauseChain(e);
    const chain = cause.length > 0 ? cause : undefined;
    if (isPanic(e)) {
      return {
        message: safeErrorField(e, "message") ?? "",
        location: e.location,
        stack: safeErrorField(e, "stack"),
        cause: chain,
        category,
      };
    }
    if (e instanceof Error) {
      return {
        message: safeErrorField(e, "message") ?? "",
        location: undefined,
        stack: safeErrorField(e, "stack"),
        cause: chain,
        category,
      };
    }
    return {
      message: safeString(e),
      location: undefined,
      stack: undefined,
      cause: chain,
      category,
    };
  } catch {
    return {
      message: "panic (details unavailable)",
      location: undefined,
      stack: undefined,
      cause: undefined,
      category,
    };
  }
}

export function reportPanic(where: string, e: unknown): void {
  reportPanicRecord(where, panicInfo(e), isPanic(e) ? "panic" : "error");
}

function reportPanicRecord(where: string, rec: PanicRecord, kind: "panic" | "error"): void {
  const lines: string[] = [`[kumiki] ${kind} in ${where}: ${rec.message}`];
  if (rec.stack !== undefined) {
    for (const line of formatStackForConsole(rec.stack, rec.message)) lines.push(line);
  }
  if (rec.cause !== undefined) {
    for (const link of rec.cause) {
      lines.push(`  Caused by: ${link.message}`);
      if (link.stack !== undefined) {
        for (const line of formatStackForConsole(link.stack, link.message)) lines.push(line);
      }
    }
  }
  console.error(lines.join("\n"));
}

function formatStackForConsole(stack: string, message: string): string[] {
  const raw = stack.split("\n");
  const trimmed =
    raw.length > 0 && raw[0] !== undefined && raw[0].includes(message) ? raw.slice(1) : raw;
  const out: string[] = [];
  for (const line of trimmed) {
    const l = line.replace(/\s+$/, "");
    if (l.length === 0) continue;
    out.push(l.startsWith(" ") || l.startsWith("\t") ? `  ${l.trim()}` : `  ${l}`);
  }
  return out;
}

export function reportUnhandledEffectError(effect: string, value: unknown): void {
  const message =
    value && typeof value === "object" && "message" in value
      ? String((value as { message: unknown }).message)
      : String(value);
  console.error(`[kumiki] effect "${effect}" returned an error with no .err reducer: ${message}`);
}

/** A minimal top-level fallback for a render panic with no enclosing boundary. */
export function renderPanicFallback(e: unknown): HTMLElement {
  const { message, location } = panicInfo(e, "tile-render");
  const div = document.createElement("div");
  div.dataset.kumikiPanic = location ?? "";
  div.setAttribute("role", "alert");
  div.textContent = `Something went wrong: ${message}`;
  return div;
}

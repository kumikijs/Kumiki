import { vi } from "vitest";

/**
 * The `fetch` double the end-to-end HTTP tests mount against, and the two
 * lookups that go with it.
 *
 * happy-dom hands a stub a `Request` where the runtime's own unit tests pass a
 * string, and a header may arrive as a `Headers`, an entry list or a plain
 * object. Each test used to normalise both itself, so a difference between two
 * of these files read as a difference between two behaviours.
 *
 * Only the tests that observe *what a request carried* share this. A stub that
 * counts attempts and answers by attempt number — the retry ladder — is a
 * different thing wearing a similar shape, and is left where it is.
 */

export type FetchCall = { url: string; init: RequestInit };

export type FetchDouble = {
  /** Every call so far, in order. */
  calls: FetchCall[];
  /** Put back what was there before. Call it from `afterEach`. */
  restore: () => void;
};

/** Replace `globalThis.fetch` with a recorder that answers via `responder`. */
export function stubFetch(
  responder: (call: FetchCall) => Response | Promise<Response>,
): FetchDouble {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = typeof url === "string" ? url : (url as Request).url;
    const call: FetchCall = { url: u, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** One header out of whichever shape `fetch` was given, or `null`. */
export function readHeader(h: HeadersInit | undefined, name: string): string | null {
  if (!h) return null;
  if (h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) {
    for (const [k, v] of h) if (k === name) return v;
    return null;
  }
  return (h as Record<string, string>)[name] ?? null;
}

/** Click the first button whose text contains `text`; throw if there is none. */
export function clickByText(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

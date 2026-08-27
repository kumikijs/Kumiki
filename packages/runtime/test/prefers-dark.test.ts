// `prefers-dark()` has two answers and the test environment only ever produces
// one of them: happy-dom implements `matchMedia` and reports no dark
// preference, so every example and scenario exercises the false branch. The
// true branch — the one an actual dark-mode user gets — and the no-`matchMedia`
// branch that SSR takes are driven here by stubbing the query.

import { afterEach, describe, expect, it } from "vitest";
import { _stdlibCore } from "../src/stdlib.ts";

type MatchMedia = typeof window.matchMedia;
const original: MatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { value: original, configurable: true });
});

function stubMatchMedia(value: unknown): void {
  Object.defineProperty(window, "matchMedia", { value, configurable: true });
}

describe("prefersDark", () => {
  it("is false when the environment reports no dark preference", () => {
    // The default happy-dom answer, which is what the examples run against.
    expect(_stdlibCore.prefersDark()).toBe(false);
  });

  it("is true when it does", () => {
    let asked: string | undefined;
    stubMatchMedia((query: string) => {
      asked = query;
      return { matches: true };
    });
    expect(_stdlibCore.prefersDark()).toBe(true);
    expect(asked).toBe("(prefers-color-scheme: dark)");
  });

  it("is false where matchMedia does not exist, rather than throwing", () => {
    // SSR. A theme-picking reducer runs on `app.start`, so throwing here would
    // take the whole render down.
    stubMatchMedia(undefined);
    expect(_stdlibCore.prefersDark()).toBe(false);
  });
});

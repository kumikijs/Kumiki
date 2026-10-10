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
    stubMatchMedia(undefined);
    expect(_stdlibCore.prefersDark()).toBe(false);
  });
});

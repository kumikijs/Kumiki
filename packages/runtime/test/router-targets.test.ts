import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppShape, Router } from "../src/core.ts";
import { routing, splitPath } from "../src/router.ts";
import { defined } from "./helpers/defined.ts";

const held = (router: Router): string => {
  const at = router.read();
  return at.pathname + at.search + at.hash;
};

describe("the memory router holds a target as the URL parser writes it", () => {
  it.each([
    ["/docs/intro", "?page=2", "/docs/intro?page=2"],
    ["/docs/intro", "#faq", "/docs/intro#faq"],
    ["/docs/intro", "install", "/docs/install"],
    ["/docs/intro", "../guide", "/guide"],
    ["/docs/intro?page=2#faq", "", "/docs/intro?page=2"],
    ["/docs/intro", "/docs/intro#faq", "/docs/intro#faq"],
    ["/docs/intro", "/docs/./x/../y", "/docs/y"],
    ["/docs/intro", "/ja/概要", "/ja/%E6%A6%82%E8%A6%81"],
    ["/docs/intro", "/docs/intro#概要", "/docs/intro#%E6%A6%82%E8%A6%81"],
    ["/docs/intro", "#概要", "/docs/intro#%E6%A6%82%E8%A6%81"],
    ["/docs/intro", "/a b?q=x y", "/a%20b?q=x%20y"],
    ["/docs/intro", "/items/100%", "/items/100%"],
    ["/docs/intro", "/items/100% off", "/items/100%%20off"],
    ["/docs/intro", "/items/50%ブ", "/items/50%%E3%83%96"],
    ["/docs/あ", "#faq", "/docs/%E3%81%82#faq"],
    ["/docs/あ", "?page=2", "/docs/%E3%81%82?page=2"],
    ["/docs/あ", "", "/docs/%E3%81%82"],
  ])("on %s, %j is held as %s", (at, to, expected) => {
    const pushed = routing.createRouter("memory", at);
    pushed.push(to);
    expect(held(pushed)).toBe(expected);
    const replaced = routing.createRouter("memory", at);
    replaced.replace(to);
    expect(held(replaced)).toBe(expected);
  });

  it.each([
    ["//example.com/x"],
    ["https://example.com/x"],
    ["mailto:a@example.com"],
    ["http://["],
  ])("leaves %s, which names an origin of its own or is not a URL, as written", (to) => {
    const router = routing.createRouter("memory", "/docs/intro");
    router.push(to);
    expect(router.read().pathname).toBe(splitPath(to).pathname);
  });

  it.each([
    ["/docs/あ", "/docs/%E3%81%82"],
    ["/docs#概要", "/docs#%E6%A6%82%E8%A6%81"],
    ["docs", "/docs"],
    ["", "/"],
  ])("starts at the initial path %j as %s", (initial, expected) => {
    expect(held(routing.createRouter("memory", initial))).toBe(expected);
  });
});

describe("a static segment", () => {
  it.each([
    ["/ja/概要", "/ja/%E6%A6%82%E8%A6%81", true],
    ["/ja/概要", "/ja/概要", true],
    ["/a b", "/a%20b", true],
    ["/about", "/%61bout", false],
    ["/about", "/about%", false],
  ])("%s matches %s: %s, as the URL parser writes it and never decoded", (pattern, path, ok) => {
    expect(routing.matchPattern(pattern, path) !== null).toBe(ok);
  });
});

describe("routing.jump", () => {
  const routes: AppShape["routes"] = [
    { pattern: "/docs/:page", tile: () => ({ kind: "page", children: [] }) },
    { pattern: "/404", tile: () => ({ kind: "page", children: [] }) },
  ];
  const parsed = (url: string) => routing.parseLocation(routes, splitPath(url));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["/docs/intro", "/docs/intro#faq", true],
    ["/docs/intro#top", "/docs/intro#faq", true],
    ["/docs/intro#faq", "/docs/intro#faq", true],
    ["/docs/intro?page=2", "/docs/intro?page=2#faq", true],
    ["/docs/intro", "/docs/intro?page=3#faq", false],
    ["/docs/intro#faq", "/docs/intro", false],
    ["/docs/intro", "/docs/other#faq", false],
  ])("from %s to %s is an in-page jump: %s", (from, to, isJump) => {
    expect(routing.jump(parsed(from), parsed(to), document) !== undefined).toBe(isJump);
  });

  // `#50% off` is held as `50%%20off`, whose `%%2` is no escape, so it is looked up as written only.
  it.each([
    ["#faq", "faq", true],
    ["#%E6%A6%82%E8%A6%81", "概要", true],
    ["#100%", "100%", true],
    ["#50%%20off", "50% off", false],
  ])("the hash %s finds the element with id %j: %s", (hash, id, found) => {
    const el = document.createElement("h2");
    el.id = id;
    document.body.append(el);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      defined(routing.jump(parsed("/docs/intro"), parsed(`/docs/intro${hash}`), el), "a jump")();
      expect(scroll.mock.contexts).toEqual(found ? [el] : []);
    } finally {
      el.remove();
    }
  });
});

import { type AppShape, defineKumikiElement, type ParsedRoute } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";
import { press, tick, withMounted } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const SRC = `
slot enters : Int = 0
slot leaves : Int = 0
reducer countDocs  on=route.enter("/docs/:page") do= enters := enters + 1
reducer countLeave on=route.leave("/docs/:page") do= leaves := leaves + 1
reducer goInstall on=ui.click(InstallBtn) do= emit navigate({path: "install", params: {}})
reducer goGuide   on=ui.click(GuideBtn)   do= emit navigate-replace({path: "../guide?from=docs", params: {}})
reducer goFaq     on=ui.click(FaqBtn)     do= emit navigate-replace({path: "#faq", params: {}})
reducer goAway    on=ui.click(AwayBtn)    do= emit navigate({path: "https://example.com/docs/abs", params: {}})
reducer goBack    on=ui.click(BackBtn)    do= emit navigate-back()
tile InstallBtn = button(text="navigate install", onClick=goInstall)
tile GuideBtn   = button(text="replace ../guide", onClick=goGuide)
tile FaqBtn     = button(text="replace #faq", onClick=goFaq)
tile AwayBtn    = button(text="navigate off-origin", onClick=goAway)
tile BackBtn    = button(text="Back", onClick=goBack)
tile Docs = page(
    heading("Docs " + route.params.get-or("page", "?") + " page " + route.query.get-or("page", "1")),
    link(to="?page=2") {text: "Next page"},
    link(to="?page=3#faq") {text: "Page 3 FAQ"},
    link(to="") {text: "This page"},
    link(to="#faq") {text: "Jump to FAQ"},
    link(to=route.path + "#faq") {text: "Same page FAQ"},
    link(to="#nowhere") {text: "Dead anchor"},
    link(to="#概要") {text: "Overview anchor"},
    link(to="install") {text: "Install"},
    link(to="old") {text: "Old"},
    link(to="../guide") {text: "Guide"},
    link(to="../chat") {text: "Chat"},
    link(to="/docs/abs") {text: "Absolute"},
    link(to="/ja/概要") {text: "Overview page"},
    link(to="http://[") {text: "Not a URL"},
    InstallBtn,
    GuideBtn,
    FaqBtn,
    AwayBtn,
    BackBtn,
    heading("FAQ") {id: "faq"},
    heading("概要") {id: "概要"})
tile Guide    = page(heading("Guide from " + route.query.get-or("from", "-")))
tile Overview = page(heading("Overview"))
tile Chat
    scroll-restoration = false
    = page(heading("Chat"), link(to="#faq") {text: "Chat FAQ"}, heading("FAQ") {id: "faq"})
tile NotFound = page(heading("Not found " + route.path))
app RelativeTargets
    caps   = [nav.push, nav.replace, nav.back]
    routes = {
        "/docs/old"   ->> "moved",
        "/docs/:page" -> Docs,
        "/guide"      -> Guide,
        "/chat"       -> Chat,
        "/ja/概要"    -> Overview,
        "/404"        -> NotFound
    }
    init   = []
`;

const CAPS = ["nav.push", "nav.replace", "nav.back"];
const MODES = ["memory", "history"] as const;

/**
 * Each row runs from an ASCII location and from two the URL parser percent-encodes. The last
 * one's `%%20` is no escape, so its param is kept as written, the same under both routers.
 */
const STARTS = [
  { initial: "/docs/intro", held: "/docs/intro", page: "intro" },
  { initial: "/docs/あ", held: "/docs/%E3%81%82", page: "あ" },
  { initial: "/docs/100% off", held: "/docs/100%%20off", page: "100%%20off" },
] as const;
const START = STARTS[0];

/** Where `scrollIntoView` leaves the window, so a later Back or Forward has a position to keep. */
const ANCHOR_Y = 2000;

type Mode = (typeof MODES)[number];
type Start = (typeof STARTS)[number];
type Mounted = { app: AppShape & { live?: Record<string, unknown> }; root: ParentNode };

let scrolled = { x: 0, y: 0 };
let scrollTo: ReturnType<typeof vi.spyOn>;
let scrollIntoView: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // happy-dom scrolls nothing, so the calls are what there is to observe, and the window's
  // position is what they last asked for.
  scrolled = { x: 0, y: 0 };
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(((x: number, y: number) => {
    scrolled = { x, y };
  }) as typeof window.scrollTo);
  scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {
    scrolled = { x: 0, y: ANCHOR_Y };
  });
  vi.spyOn(window, "scrollX", "get").mockImplementation(() => scrolled.x);
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrolled.y);
});

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

/** Mount the app at `initial` under `mode`'s router, run `body` against it, and unmount. */
async function at(mode: Mode, initial: string, body: (m: Mounted) => Promise<void>): Promise<void> {
  const app = (await loadSource(SRC, CAPS)) as Mounted["app"];
  if (mode === "history") history.replaceState(null, "", initial);
  const options = mode === "memory" ? ({ router: "memory", initialPath: initial } as const) : {};
  await withMounted(app, (root) => body({ app, root }), options);
}

/** Back, as each router is driven: a `navigate-back` effect under memory, the browser's under history. */
async function back(mode: Mode, m: Mounted): Promise<void> {
  if (mode === "memory") await press(m.root, "Back");
  else history.back();
  await tick(25);
}

/** Where the app is: the route it rendered, as the history router would show it in the URL bar. */
function where(m: Mounted) {
  const r = m.app.live?.route as ParsedRoute;
  const search = new URLSearchParams(r.query).toString();
  return {
    url: r.path + (search && `?${search}`) + (r.hash._tag === "Some" ? `#${r.hash._0}` : ""),
    heading: m.root.querySelector("h1")?.textContent ?? undefined,
    enters: m.app.live?.enters,
    leaves: m.app.live?.leaves,
  };
}

type Where = ReturnType<typeof where>;

// From `initial`, which has entered `/docs/:page` once.
const cases = ({ held, page }: Start): Array<[string[], Where]> => {
  const docs = (url: string, n: number, enters: number): Where => ({
    url,
    heading: `Docs ${page} page ${n}`,
    enters,
    leaves: 0,
  });
  const away = (url: string, heading: string, enters: number): Where => ({
    url,
    heading,
    enters,
    leaves: 1,
  });
  return [
    [["Next page"], docs(`${held}?page=2`, 2, 2)],
    [["Jump to FAQ"], docs(`${held}#faq`, 1, 1)],
    [["Same page FAQ"], docs(`${held}#faq`, 1, 1)],
    [["replace #faq"], docs(`${held}#faq`, 1, 1)],
    [["Next page", "Jump to FAQ"], docs(`${held}?page=2#faq`, 2, 2)],
    [["Page 3 FAQ"], docs(`${held}?page=3#faq`, 3, 2)],
    [["This page"], docs(held, 1, 2)],
    [["Jump to FAQ", "This page"], docs(held, 1, 2)],
    [["Install"], away("/docs/install", "Docs install page 1", 2)],
    [["Old"], away("/docs/moved", "Docs moved page 1", 2)],
    [["Guide"], away("/guide", "Guide from -", 1)],
    [["Absolute"], away("/docs/abs", "Docs abs page 1", 2)],
    [["Overview page"], away("/ja/%E6%A6%82%E8%A6%81", "Overview", 1)],
    [["navigate install"], away("/docs/install", "Docs install page 1", 2)],
    [["replace ../guide"], away("/guide?from=docs", "Guide from docs", 1)],
  ];
};

describe.each(MODES)("a relative target under the %s router", (mode) => {
  describe.each(STARTS)("from $initial", (start) => {
    it.each(cases(start))("%j lands where a browser resolves it", (clicks, expected) =>
      at(mode, start.initial, async (m) => {
        for (const text of clicks) await press(m.root, text);
        expect(where(m)).toEqual(expected);
        if (mode === "history") {
          expect(location.pathname + location.search + location.hash).toBe(expected.url);
        }
      }));
  });
});

describe.each(MODES)("an in-page jump under the %s router", (mode) => {
  it.each(
    STARTS,
  )("from $initial scrolls the element with that id into view, and not the page to the top", (start) =>
    at(mode, start.initial, async (m) => {
      scrollTo.mockClear();
      await press(m.root, "Jump to FAQ");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      const el = scrollIntoView.mock.contexts[0] as Element;
      expect(el.id).toBe("faq");
      expect(m.root.contains(el)).toBe(true);
    }));

  it("jumps again when the same hash is followed twice", () =>
    at(mode, START.initial, async (m) => {
      await press(m.root, "Jump to FAQ");
      scrollTo.mockClear();
      scrollIntoView.mockClear();
      await press(m.root, "Jump to FAQ");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(m.app.live?.enters).toBe(1);
    }));

  it("jumps on a navigate-replace to the hash", () =>
    at(mode, START.initial, async (m) => {
      scrollTo.mockClear();
      await press(m.root, "replace #faq");
      expect(scrollTo).not.toHaveBeenCalled();
      expect((scrollIntoView.mock.contexts[0] as Element | undefined)?.id).toBe("faq");
    }));

  it("leaves the scroll position alone when no element has that id", () =>
    at(mode, START.initial, async (m) => {
      scrollTo.mockClear();
      await press(m.root, "Dead anchor");
      expect(where(m)).toEqual({
        url: "/docs/intro#nowhere",
        heading: "Docs intro page 1",
        enters: 1,
        leaves: 0,
      });
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
    }));

  it("finds the element by the percent-decoded hash", () =>
    at(mode, START.initial, async (m) => {
      scrollTo.mockClear();
      await press(m.root, "Overview anchor");
      expect((m.app.live?.route as ParsedRoute).hash).toEqual({
        _tag: "Some",
        _0: "%E6%A6%82%E8%A6%81",
      });
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect((scrollIntoView.mock.contexts[0] as Element).id).toBe("概要");
    }));

  it("still scrolls to the element on a route with scroll-restoration = false", () =>
    at(mode, START.initial, async (m) => {
      await press(m.root, "Chat");
      scrollTo.mockClear();
      await press(m.root, "Chat FAQ");
      expect(scrollTo).not.toHaveBeenCalled();
      expect((scrollIntoView.mock.contexts[0] as Element | undefined)?.id).toBe("faq");
    }));

  it("a navigation to another path still scrolls to the top", () =>
    at(mode, START.initial, async (m) => {
      scrollTo.mockClear();
      await press(m.root, "Install");
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      expect(scrollIntoView).not.toHaveBeenCalled();
    }));

  it.each(
    STARTS,
  )("Back from a jump on $initial returns to where the page was, without entering it again", (start) =>
    at(mode, start.initial, async (m) => {
      scrolled = { x: 0, y: 500 };
      await press(m.root, "Jump to FAQ");
      scrollTo.mockClear();
      scrollIntoView.mockClear();
      await back(mode, m);
      expect(where(m)).toEqual({
        url: start.held,
        heading: `Docs ${start.page} page 1`,
        enters: 1,
        leaves: 0,
      });
      expect(scrollTo.mock.calls).toEqual([[0, 500]]);
      expect(scrollIntoView).not.toHaveBeenCalled();
    }));
});

it("Forward onto a jump under the history router returns to where that entry was left", () =>
  at("history", START.initial, async (m) => {
    await press(m.root, "Jump to FAQ");
    scrolled = { x: 0, y: 2400 };
    history.back();
    await tick(25);
    scrollTo.mockClear();
    scrollIntoView.mockClear();
    history.forward();
    await tick(25);
    expect(where(m)).toEqual({
      url: "/docs/intro#faq",
      heading: "Docs intro page 1",
      enters: 1,
      leaves: 0,
    });
    expect(scrollTo.mock.calls).toEqual([[0, 2400]]);
    expect(scrollIntoView).not.toHaveBeenCalled();
  }));

it("an in-page jump in a Web Component's shadow root scrolls to the element there", async () => {
  const app = await loadSource(SRC, CAPS);
  defineKumikiElement("relative-target-embed", app, {
    router: "memory",
    initialPath: START.initial,
    shadow: true,
  });
  const host = document.createElement("relative-target-embed");
  document.body.appendChild(host);
  try {
    const shadow = defined(host.shadowRoot, "the element's shadow root");
    expect(document.getElementById("faq")).toBeNull();
    scrollTo.mockClear();
    await press(shadow, "Jump to FAQ");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(shadow.getElementById("faq"));
  } finally {
    host.remove();
  }
});

describe("a target the memory router takes as written", () => {
  it.each<[string, Where]>([
    [
      "navigate off-origin",
      {
        url: "https://example.com/docs/abs",
        heading: "Not found https://example.com/docs/abs",
        enters: 1,
        leaves: 1,
      },
    ],
    ["Not a URL", { url: "http://[", heading: "Not found http://[", enters: 1, leaves: 1 }],
  ])("%s", (text, expected) =>
    at("memory", START.initial, async (m) => {
      await press(m.root, text);
      expect(where(m)).toEqual(expected);
    }));
});

describe("a sandboxed playground iframe, whose own URL is about:srcdoc", () => {
  it.each<[string, string]>([
    ["Jump to FAQ", "/docs/intro#faq"],
    ["Next page", "/docs/intro?page=2"],
    ["Install", "/docs/install"],
    ["Absolute", "/docs/abs"],
  ])("hands %s to the memory router", (text, url) =>
    at("memory", START.initial, async (m) => {
      vi.spyOn(location, "href", "get").mockReturnValue("about:srcdoc");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await press(m.root, text);
      expect(where(m).url).toBe(url);
      expect(warn).not.toHaveBeenCalled();
    }));
});

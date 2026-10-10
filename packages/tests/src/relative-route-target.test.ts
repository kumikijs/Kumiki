import { type AppShape, defineKumikiElement, mount, type ParsedRoute } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";
import { freshRoot, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const SRC = `
slot enters : Int = 0
reducer countDocs on=route.enter("/docs/:page") do= enters := enters + 1
reducer goInstall on=ui.click(InstallBtn) do= emit navigate({path: "install", params: {}})
reducer goGuide   on=ui.click(GuideBtn)   do= emit navigate-replace({path: "../guide?from=docs", params: {}})
reducer goAway    on=ui.click(AwayBtn)    do= emit navigate({path: "https://example.com/docs/abs", params: {}})
tile InstallBtn = button(text="navigate install", onClick=goInstall)
tile GuideBtn   = button(text="replace ../guide", onClick=goGuide)
tile AwayBtn    = button(text="navigate off-origin", onClick=goAway)
tile Docs = page(
    heading("Docs " + route.params.get-or("page", "?") + " page " + route.query.get-or("page", "1")),
    link(to="?page=2") {text: "Next page"},
    link(to="?page=3#faq") {text: "Page 3 FAQ"},
    link(to="") {text: "This page"},
    link(to="#faq") {text: "Jump to FAQ"},
    link(to="#nowhere") {text: "Dead anchor"},
    link(to="#概要") {text: "Overview anchor"},
    link(to="install") {text: "Install"},
    link(to="../guide") {text: "Guide"},
    link(to="/docs/abs") {text: "Absolute"},
    link(to="/ja/概要") {text: "Overview page"},
    link(to="http://[") {text: "Not a URL"},
    InstallBtn,
    GuideBtn,
    AwayBtn,
    heading("FAQ") {id: "faq"},
    heading("概要") {id: "概要"})
tile Guide    = page(heading("Guide from " + route.query.get-or("from", "-")))
tile Overview = page(heading("Overview"))
tile NotFound = page(heading("Not found " + route.path))
app RelativeTargets
    caps   = [nav.push, nav.replace]
    routes = {"/docs/:page" -> Docs, "/guide" -> Guide, "/ja/概要" -> Overview, "/404" -> NotFound}
    init   = []
`;

const START = "/docs/intro";

type Mode = "memory" | "history";
type Hooked = AppShape & { live?: Record<string, unknown> };
type Mounted = { app: Hooked; root: HTMLElement; dispose: () => void };

let scrollTo: ReturnType<typeof vi.spyOn>;
let scrollIntoView: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // happy-dom scrolls nothing, so the calls are what there is to observe.
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});

afterEach(() => {
  scrollTo.mockRestore();
  scrollIntoView.mockRestore();
  history.replaceState(null, "", "/");
});

async function mountAt(mode: Mode): Promise<Mounted> {
  const app = (await loadSource(SRC, ["nav.push", "nav.replace"])) as Hooked;
  const root = freshRoot();
  let handle: { dispose: () => void };
  if (mode === "memory") {
    handle = mount(app, root, { router: "memory", initialPath: START });
  } else {
    history.replaceState(null, "", START);
    handle = mount(app, root);
  }
  return {
    app,
    root,
    dispose: () => {
      handle.dispose();
      root.remove();
    },
  };
}

/** A primary click on the link or button whose text is `text`. */
async function follow(root: ParentNode, text: string): Promise<void> {
  const el = [...root.querySelectorAll<HTMLElement>("a, button")].find(
    (e) => e.textContent === text,
  );
  if (!el) throw new Error(`nothing reads ${JSON.stringify(text)}`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  // A button's navigate is an effect, which the dispatcher runs on a microtask.
  await tick(0);
}

/** Where the app is: the route it rendered, as the history router would show it in the URL bar. */
function where(m: Mounted): { url: string; heading: string | undefined; enters: unknown } {
  const r = m.app.live?.route as ParsedRoute;
  const search = new URLSearchParams(r.query).toString();
  return {
    url: r.path + (search && `?${search}`) + (r.hash._tag === "Some" ? `#${r.hash._0}` : ""),
    heading: m.root.querySelector("h1")?.textContent ?? undefined,
    enters: m.app.live?.enters,
  };
}

// Every row starts at /docs/intro, which has entered `/docs/:page` once.
const CASES: Array<[string[], ReturnType<typeof where>]> = [
  [["Next page"], { url: "/docs/intro?page=2", heading: "Docs intro page 2", enters: 2 }],
  [["Jump to FAQ"], { url: "/docs/intro#faq", heading: "Docs intro page 1", enters: 1 }],
  [
    ["Next page", "Jump to FAQ"],
    { url: "/docs/intro?page=2#faq", heading: "Docs intro page 2", enters: 2 },
  ],
  [["Page 3 FAQ"], { url: "/docs/intro?page=3#faq", heading: "Docs intro page 3", enters: 2 }],
  [["This page"], { url: "/docs/intro", heading: "Docs intro page 1", enters: 2 }],
  [["Install"], { url: "/docs/install", heading: "Docs install page 1", enters: 2 }],
  [["Guide"], { url: "/guide", heading: "Guide from -", enters: 1 }],
  [["Absolute"], { url: "/docs/abs", heading: "Docs abs page 1", enters: 2 }],
  [["navigate install"], { url: "/docs/install", heading: "Docs install page 1", enters: 2 }],
  [["replace ../guide"], { url: "/guide?from=docs", heading: "Guide from docs", enters: 1 }],
];

describe.each(["memory", "history"] as const)("a relative target under the %s router", (mode) => {
  it.each(CASES)("%j lands where a browser resolves it", async (clicks, expected) => {
    const m = await mountAt(mode);
    try {
      for (const text of clicks) await follow(m.root, text);
      expect(where(m)).toEqual(expected);
      if (mode === "history") {
        expect(location.pathname + location.search + location.hash).toBe(expected.url);
      }
    } finally {
      m.dispose();
    }
  });
});

describe.each(["memory", "history"] as const)("an in-page jump under the %s router", (mode) => {
  it("scrolls the element with that id into view, and not the page to the top", async () => {
    const m = await mountAt(mode);
    try {
      scrollTo.mockClear();
      await follow(m.root, "Jump to FAQ");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect((scrollIntoView.mock.contexts[0] as Element).id).toBe("faq");
      expect(m.root.contains(scrollIntoView.mock.contexts[0] as Element)).toBe(true);
    } finally {
      m.dispose();
    }
  });

  it("jumps again when the same hash is followed twice", async () => {
    const m = await mountAt(mode);
    try {
      await follow(m.root, "Jump to FAQ");
      scrollTo.mockClear();
      scrollIntoView.mockClear();
      await follow(m.root, "Jump to FAQ");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(m.app.live?.enters).toBe(1);
    } finally {
      m.dispose();
    }
  });

  it("leaves the scroll position alone when no element has that id", async () => {
    const m = await mountAt(mode);
    try {
      scrollTo.mockClear();
      await follow(m.root, "Dead anchor");
      expect(where(m)).toEqual({
        url: "/docs/intro#nowhere",
        heading: "Docs intro page 1",
        enters: 1,
      });
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      m.dispose();
    }
  });

  it("finds the element by the percent-decoded hash, as a browser does", async () => {
    const m = await mountAt(mode);
    try {
      scrollTo.mockClear();
      await follow(m.root, "Overview anchor");
      expect((m.app.live?.route as ParsedRoute).hash).toEqual({
        _tag: "Some",
        _0: "%E6%A6%82%E8%A6%81",
      });
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect((scrollIntoView.mock.contexts[0] as Element).id).toBe("概要");
    } finally {
      m.dispose();
    }
  });

  it("a navigation to another path still scrolls to the top", async () => {
    const m = await mountAt(mode);
    try {
      scrollTo.mockClear();
      await follow(m.root, "Install");
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      m.dispose();
    }
  });
});

it("an in-page jump in a Web Component's shadow root scrolls to the element there", async () => {
  const app = await loadSource(SRC, ["nav.push", "nav.replace"]);
  defineKumikiElement("relative-target-embed", app, {
    router: "memory",
    initialPath: START,
    shadow: true,
  });
  const host = document.createElement("relative-target-embed");
  document.body.appendChild(host);
  try {
    const shadow = defined(host.shadowRoot, "the element's shadow root");
    expect(document.getElementById("faq")).toBeNull();
    scrollTo.mockClear();
    await follow(shadow, "Jump to FAQ");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(shadow.getElementById("faq"));
  } finally {
    host.remove();
  }
});

describe("a target the memory router takes as written", () => {
  it.each<[string, ReturnType<typeof where>]>([
    ["Overview page", { url: "/ja/概要", heading: "Overview", enters: 1 }],
    [
      "navigate off-origin",
      {
        url: "https://example.com/docs/abs",
        heading: "Not found https://example.com/docs/abs",
        enters: 1,
      },
    ],
    ["Not a URL", { url: "http://[", heading: "Not found http://[", enters: 1 }],
  ])("%s", async (text, expected) => {
    const m = await mountAt("memory");
    try {
      await follow(m.root, text);
      expect(where(m)).toEqual(expected);
    } finally {
      m.dispose();
    }
  });
});

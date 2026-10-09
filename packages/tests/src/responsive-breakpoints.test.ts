import { feature } from "@kumikijs/examples";
import { mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("158-responsive-breakpoints");

const DEFAULT_THEME = `
tile App = column(
    grid(text("a"), text("b"), text("c"), text("d")) {cols: {base: 1, md: 2, lg: 4}, id: "tracks"},
    column(text("x")) {gap: {base: "sm", md: "lg"}, id: "spaced"})
app Resp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

function viewport(width: number): void {
  vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
    const m = /min-width:\s*([\d.]+)(px|rem|em)\)/.exec(q);
    const px = m ? Number(m[1]) * (m[2] === "px" ? 1 : 16) : Number.NaN;
    return { matches: width >= px, media: q } as MediaQueryList;
  });
}

/** An app whose theme declares only `breakpoints`, around a `cols` map. */
const themed = (breakpoints: string, cols: string): string => `
theme T = {
    breakpoints: { ${breakpoints} }
}
tile App = column(
    grid(text("a"), text("b"), text("c"), text("d")) {cols: ${cols}, id: "tracks"},
    column(text("x")) {gap: {base: "sm", md: "lg"}, id: "spaced"})
app Resp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
    theme  = T
`;

afterEach(() => {
  vi.restoreAllMocks();
});

type Shown = { cols: string; rows: string; gap: string };

/**
 * The inline styles the two probed elements carry at `width`, read as strings while the app is still mounted.
 */
async function styleAt(
  src: string | { file: string },
  width: number,
): Promise<{ tracks: Shown; spaced: Shown }> {
  viewport(width);
  const app = typeof src === "string" ? await loadSource(src) : await loadApp(src.file);
  const root = freshRoot();
  const handle = mount(app, root);
  const pick = (id: string): Shown => {
    const style = (root.querySelector(`#${id}`) as HTMLElement).style;
    return { cols: style.gridTemplateColumns, rows: style.gridTemplateRows, gap: style.gap };
  };
  const out = { tracks: pick("tracks"), spaced: pick("spaced") };
  handle.dispose();
  root.remove();
  return out;
}

describe("responsive grid tracks", () => {
  it.each([
    [400, "repeat(1, 1fr)"],
    [800, "repeat(2, 1fr)"],
    [1100, "repeat(4, 1fr)"],
  ])("a cols map at %ipx gives %s", async (width, cols) => {
    const { tracks } = await styleAt(DEFAULT_THEME, width);
    expect(tracks.cols).toBe(cols);
  });

  it("a rows map is picked the same way", async () => {
    expect((await styleAt({ file: EXAMPLE }, 400)).tracks.rows).toBe("auto");
    expect((await styleAt({ file: EXAMPLE }, 1000)).tracks.rows).toBe("80px");
  });

  it("SSR serves the base tracks", async () => {
    const out = await renderToString(await loadSource(DEFAULT_THEME));
    expect(out.html).toContain("grid-template-columns: repeat(1, 1fr)");
  });

  it("SSR serves the base of a rows map", async () => {
    const out = await renderToString(await loadApp(EXAMPLE));
    expect(out.html).toContain("grid-template-rows: auto");
    expect(out.html).not.toContain("80px");
  });
});

describe("the active theme's breakpoints", () => {
  it("move where a key starts", async () => {
    // Narrow puts `md` at 500px: 600px is `md` there, and only `base` under the 768px default.
    const narrow = await styleAt({ file: EXAMPLE }, 600);
    expect(narrow.spaced.gap).toBe("24px");
    expect(narrow.tracks.cols).toBe("repeat(2, 1fr)");
    expect((await styleAt(DEFAULT_THEME, 600)).spaced.gap).toBe("8px");
  });

  it("include a key the theme adds of its own", async () => {
    const wide = await styleAt({ file: EXAMPLE }, 1900);
    expect(wide.tracks.cols).toBe("repeat(6, 1fr)");
  });
});

describe("a theme that declares some breakpoints", () => {
  it("keeps the default for a key it leaves out", async () => {
    // Only `md` moves; `lg` is still the 1024px default, so 1100px is `lg` and 900px is the theme's `md`.
    const src = themed('md: "500px"', "{base: 1, md: 2, lg: 4}");
    expect((await styleAt(src, 1100)).tracks.cols).toBe("repeat(4, 1fr)");
    expect((await styleAt(src, 900)).tracks.cols).toBe("repeat(2, 1fr)");
  });

  it("takes a bare number as px", async () => {
    const src = themed("md: 500", "{base: 1, md: 2}");
    expect((await styleAt(src, 600)).tracks.cols).toBe("repeat(2, 1fr)");
    expect((await styleAt(src, 400)).tracks.cols).toBe("repeat(1, 1fr)");
  });
});

describe("breakpoints are ordered by width across units", () => {
  it("a rem width sorts by its px size, above sm's 640px", async () => {
    // 48rem is 768px: at 800px both `sm` and `md` match, and `md` is wider.
    const src = themed('md: "48rem"', "{base: 1, sm: 2, md: 3}");
    expect((await styleAt(src, 800)).tracks.cols).toBe("repeat(3, 1fr)");
    expect((await styleAt(src, 700)).tracks.cols).toBe("repeat(2, 1fr)");
  });

  it("an em width sorts the same way", async () => {
    // 50em is 800px: at 900px both `sm` and `lg` match, and `lg` is wider.
    const src = themed('lg: "50em"', "{base: 1, sm: 2, lg: 3}");
    expect((await styleAt(src, 900)).tracks.cols).toBe("repeat(3, 1fr)");
    expect((await styleAt(src, 700)).tracks.cols).toBe("repeat(2, 1fr)");
  });

  it("a width that is not one is dropped and leaves the others in order", async () => {
    // A nested theme value has no width. Left in, it compared as NaN and put `sm` ahead of `lg`, so 1100px resolved to `sm`.
    const src = themed('md: { x: "1px" }', "{base: 1, sm: 2, md: 3, lg: 4}");
    expect((await styleAt(src, 1100)).tracks.cols).toBe("repeat(4, 1fr)");
    const asked = vi.mocked(window.matchMedia).mock.calls.map(([q]) => q);
    expect(asked.some((q) => q.includes("object"))).toBe(false);
  });
});

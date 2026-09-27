// style.md §4.5: a `{base, …}` map picks the largest breakpoint the viewport
// reaches, the breakpoints are the active theme's (over §4.2's defaults), and
// `cols` / `rows` take a map like any other responsive prop. happy-dom has no
// layout viewport, so `window.matchMedia` is answered here for a chosen width;
// the e2e tier (`responsive-breakpoints.spec.ts`) repeats the grid claim in
// Chromium at real viewport sizes.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "158-responsive-breakpoints.kumiki");

const DEFAULT_THEME = `
tile App = column(
    grid(text("a"), text("b"), text("c"), text("d")) {cols: {base: 1, md: 2, lg: 4}, id: "tracks"},
    column(text("x")) {gap: {base: "sm", md: "lg"}, id: "spaced"})
app Resp
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** Answer `(min-width: Npx)` queries as a viewport `width` px wide would. */
function viewport(width: number): void {
  vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
    const m = /min-width:\s*([\d.]+)px/.exec(q);
    return { matches: m ? width >= Number(m[1]) : false, media: q } as MediaQueryList;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function styleAt(
  src: string | { file: string },
  width: number,
): Promise<{ tracks: CSSStyleDeclaration; spaced: CSSStyleDeclaration }> {
  viewport(width);
  const app = typeof src === "string" ? await loadSource(src) : await loadApp(src.file);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(app, root);
  const pick = (id: string) => (root.querySelector(`#${id}`) as HTMLElement).style;
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
    expect(tracks.gridTemplateColumns).toBe(cols);
  });

  it("a rows map is picked the same way", async () => {
    expect((await styleAt({ file: EXAMPLE }, 400)).tracks.gridTemplateRows).toBe("auto");
    expect((await styleAt({ file: EXAMPLE }, 1000)).tracks.gridTemplateRows).toBe("80px");
  });

  it("SSR serves the base tracks", async () => {
    const out = await renderToString(await loadSource(DEFAULT_THEME));
    expect(out.html).toContain("grid-template-columns: repeat(1, 1fr)");
  });
});

describe("the active theme's breakpoints", () => {
  it("move where a key starts", async () => {
    // Narrow puts `md` at 500px: 600px is `md` there, and only `base` under the
    // 768px default.
    const narrow = await styleAt({ file: EXAMPLE }, 600);
    expect(narrow.spaced.gap).toBe("24px");
    expect(narrow.tracks.gridTemplateColumns).toBe("repeat(2, 1fr)");
    expect((await styleAt(DEFAULT_THEME, 600)).spaced.gap).toBe("8px");
  });

  it("include a key the theme adds of its own", async () => {
    const wide = await styleAt({ file: EXAMPLE }, 1900);
    expect(wide.tracks.gridTemplateColumns).toBe("repeat(6, 1fr)");
  });
});

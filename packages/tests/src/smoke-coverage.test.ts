import { smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { mountApp, withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

async function report(src: string): ReturnType<typeof smoke> {
  const app = await loadSource(src);
  return withRoot((root) => smoke(app, root, { settleMs: 20 }));
}

const APP = (tiles: string, extra = "", appExtra = ""): string => `${extra}
${tiles}
app Probe
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
${appExtra}`;

const ICON_THEME = `theme Icons = {icons: {check: "M4 12l5 5 11-11"}}`;

describe("a render with nothing in it is not a render", () => {
  it.each(["column()", "column(row(), column())"])("reports %s as not rendered", async (tree) => {
    const r = await report(APP(`tile App = ${tree}`));
    expect(r.rendered).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message)).toContain("root is empty after mount");
  });

  it("counts text as content", async () => {
    const r = await report(APP('tile App = column(text("hello"))'));
    expect(r.rendered).toBe(true);
    expect(r.ok).toBe(true);
  });

  const ICON_APP = APP('tile App = column(icon(name="check"))', ICON_THEME, "    theme  = Icons\n");

  const CONTENT_TILES: { selector: string; tile: string; src?: string }[] = [
    { selector: "img", tile: 'image(src="/logo.png", alt="Logo")' },
    { selector: "svg", tile: 'icon(name="check")', src: ICON_APP },
    { selector: "video", tile: 'video(src="/clip.mp4")' },
    { selector: "input", tile: 'input(placeholder="name")' },
    { selector: "textarea", tile: 'textarea(placeholder="notes")' },
    { selector: "select", tile: "select(options=[])" },
    { selector: "button", tile: 'button(text="", aria-label="close")' },
    { selector: "progress", tile: "progress(value=0.5)" },
    { selector: "hr", tile: "divider()" },
    { selector: "[contenteditable='true']", tile: "editable()" },
    { selector: "[role='status']", tile: "spinner()" },
    { selector: "[aria-busy='true']", tile: "skeleton()" },
  ];

  it.each(CONTENT_TILES)("counts $selector as content, and $tile produces it", async ({
    selector,
    tile,
    src: override,
  }) => {
    const src = override ?? APP(`tile App = column(${tile})`);
    const app = await loadSource(src);
    const { root, handle } = mountApp(app);
    try {
      expect(root.querySelector(selector)).not.toBeNull();
    } finally {
      handle.dispose();
      root.remove();
    }
    expect((await report(src)).rendered).toBe(true);
  });
});

describe("a form is submitted, not merely rendered", () => {
  const FORM_APP = APP(
    `tile Field = input(bind=draft, placeholder="what needs doing")
tile Entry = form(Field)
tile App   = column(Entry, text("saved: " + saved), text("count: " + count.show))`,
    `slot draft : Text = ""
slot saved : Text = ""
slot count : Int  = 0

reducer submit
    on=ui.submit(Entry)
    do= saved := draft
        count := count + 1
`,
  );

  it("fires the submit reducer of a form with no submit button", async () => {
    const app = await loadSource(FORM_APP);
    const r = await withRoot((root) => smoke(app, root, { settleMs: 20 }));
    expect(r.ok).toBe(true);
    // The slots, not the DOM: `smoke` disposes the mount before it returns, and disposal detaches the tree it rendered.
    expect(app.live).toMatchObject({ count: 1, saved: "smoke" });
  });
});

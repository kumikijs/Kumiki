import { mount, SMOKE_CONTENT_SELECTORS, smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

async function report(src: string): ReturnType<typeof smoke> {
  const app = await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    return await smoke(app, root, { settleMs: 20 });
  } finally {
    root.remove();
  }
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
  it("reports an empty container tree as not rendered", async () => {
    const r = await report(APP("tile App = column()"));
    expect(r.rendered).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message)).toContain("root is empty after mount");
  });

  it("reports nested empty containers as not rendered", async () => {
    const r = await report(APP("tile App = column(row(), column())"));
    expect(r.rendered).toBe(false);
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

  it("has a row for every selector the check is built from, and no others", () => {
    expect(CONTENT_TILES.map((c) => c.selector)).toEqual([...SMOKE_CONTENT_SELECTORS]);
  });

  for (const { selector, tile, src: override } of CONTENT_TILES) {
    it(`counts ${selector} as content, and ${tile.split("(")[0]} produces it`, async () => {
      const src = override ?? APP(`tile App = column(${tile})`);
      const root = document.createElement("div");
      document.body.appendChild(root);
      const handle = mount(await loadSource(src), root);
      try {
        expect(root.querySelector(selector)).not.toBeNull();
      } finally {
        handle.dispose();
        root.remove();
      }
      expect((await report(src)).rendered).toBe(true);
    });
  }
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

  // Read the slots rather than the DOM: `smoke` disposes the mount before it returns, and disposal detaches the tree it rendered.
  async function driveForm(): Promise<{ ok: boolean; saved: unknown; count: unknown }> {
    const app = await loadSource(FORM_APP);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const r = await smoke(app, root, { settleMs: 20 });
      const live = (app as { live?: Record<string, unknown> }).live ?? {};
      return { ok: r.ok, saved: live.saved, count: live.count };
    } finally {
      root.remove();
    }
  }

  it("fires the submit reducer of a form with no submit button", async () => {
    const { ok, count, saved } = await driveForm();
    expect(ok).toBe(true);
    expect(count).toBe(1);
    expect(saved).toBe("smoke");
  });
});

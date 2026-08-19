// What `kumiki smoke` claims about an app it has driven.
//
// The tier exists to catch "it compiled but renders nothing / throws when you
// use it". Two of its answers used to be softer than they read: a tree of empty
// containers counted as rendered, and a form with no submit button — the shape
// the spec's own example uses — was never submitted, so a reducer wired to
// `ui.submit` was reported as exercised by an app that never ran it.

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

// An icon renders its `<svg>` only for a name that resolves; an unresolved one
// falls back to `[name]` text, which would satisfy the check for the wrong
// reason. A theme is how a program supplies the path without the compiler's
// built-in icon pass.
const ICON_THEME = `theme Icons = {icons: {check: "M4 12l5 5 11-11"}}`;

describe("a render with nothing in it is not a render", () => {
  // The failure this tier is named for. `column()` puts a <div> under the root,
  // so counting child *elements* answered "rendered" for an app that shows the
  // user an empty page.
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

  // A screen can be entirely non-textual and still be a screen. The rule is
  // "an element that shows or accepts something", not "an element".
  //
  // One row per selector in the list the check is built from, and the list is
  // asserted to be exactly these rows: a selector no tile produces reads as
  // coverage while matching nothing, and a tile that produces none of them is
  // an app that cannot show its first paint. The first version of this list
  // had seven dead entries and no row for `skeleton`, so an app whose first
  // paint is a placeholder failed the tier.
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
      // Both halves, and they need separate mounts: `smoke` disposes the tree
      // before it returns, so the selector is checked against a mount this
      // test holds open. Asserting only `rendered` would pass for a tile that
      // emits some *other* entry on the list.
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

  // Read the slots rather than the DOM: `smoke` disposes the mount before it
  // returns, and disposal detaches the tree it rendered.
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

  // The buttonless form is what was genuinely unreachable, and it is the shape
  // `02-todomvc` and the spec's own example use. (A form *with* a default-type
  // button already submitted under this harness's synthetic click: happy-dom
  // runs the activation behaviour, and the `preventDefault` the runtime
  // installs on the button does not stop it, because the click `fire()` builds
  // is not cancelable.)
  it("fires the submit reducer of a form with no submit button", async () => {
    const { ok, count } = await driveForm();
    expect(ok).toBe(true);
    expect(count).toBe(1);
  });

  // Order matters as much as the event: a form submitted before its own fields
  // are filled runs the reducer against the state it mounted with, which for
  // `Text where nonempty` is the value the reducer is written to reject.
  it("fills the fields inside a form before submitting it", async () => {
    const { saved } = await driveForm();
    expect(saved).toBe("smoke");
  });
});

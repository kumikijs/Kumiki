// What `kumiki smoke` claims about an app it has driven.
//
// The tier exists to catch "it compiled but renders nothing / throws when you
// use it". Two of its answers used to be softer than they read: a tree of empty
// containers counted as rendered, and a `form` was never submitted — so a
// reducer wired to `ui.submit` was reported as exercised by an app that never
// ran it.

import { smoke } from "@kumikijs/runtime";
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

const APP = (tiles: string, extra = ""): string => `${extra}
${tiles}
app Probe
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

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
  it("counts a content leaf with no text as content", async () => {
    const r = await report(APP('tile App = column(image(src="/logo.png", alt="Logo"))'));
    expect(r.rendered).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("counts a bare control as content", async () => {
    const r = await report(APP('tile App = column(input(placeholder="name"))'));
    expect(r.rendered).toBe(true);
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

  // A synthetic click on a submit button does not submit a form in any DOM, so
  // before this the `ui.submit` path was unreachable from the tier whether or
  // not the form had a button.
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

  // A synthetic click on a submit button does not submit a form in any DOM, so
  // before this the `ui.submit` path was unreachable from the tier whether or
  // not the form had a button.
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

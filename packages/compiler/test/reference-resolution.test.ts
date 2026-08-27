// Reference sites that name a definition but were never resolved against one.
//
// Each of these fails the same way when the name is wrong: nothing is reported,
// and the thing the name was supposed to reach simply never happens — the
// reducer never fires, the 401 handler never runs, the app renders unthemed.
// That is the failure mode a name-resolution diagnostic exists to prevent, so
// every site that writes a name gets a test here.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const diags = (src: string) => check(parse(lex(src)));
const codes = (src: string) => diags(src).map((e) => e.code);

const TAIL = `
tile App = column(Panel)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const PANEL = `slot n : Int = 0\ntile Panel = column(text("hi"))\n`;

describe("lifecycle selectors (E0211)", () => {
  for (const ev of ["mount", "unmount"]) {
    it(`reports an undeclared tile in tile.${ev}`, () => {
      const err = diags(`${PANEL}reducer r on=tile.${ev}(Pannel) do= n := 1${TAIL}`).find(
        (e) => e.code === "E0211",
      );
      expect(err, `no E0211 for tile.${ev}`).toBeDefined();
      expect(err?.message).toContain("Pannel");
      // At the tile name, not at the whole pattern: `fix` rewrites what the
      // position points at.
      expect(`${err?.pos.line}:${err?.pos.col}`).toBe(`3:${`reducer r on=tile.${ev}(`.length + 1}`);
    });

    it(`accepts a declared tile in tile.${ev}`, () => {
      expect(codes(`${PANEL}reducer r on=tile.${ev}(Panel) do= n := 1${TAIL}`)).not.toContain(
        "E0211",
      );
    });
  }

  it("has no wildcard to exempt", () => {
    // `_` is a `ui.*` selector sentinel for reducers dispatched indirectly
    // (`emit confirm({onYes: r})`). A lifecycle event fires when a *named* tile
    // enters the tree, so `_` there names a tile that cannot exist.
    expect(codes(`${PANEL}reducer r on=tile.mount(_) do= n := 1${TAIL}`)).toContain("E0211");
  });
});

describe("effect-event selectors (E0104)", () => {
  for (const outcome of ["ok", "err"]) {
    it(`reports an undeclared effect in .${outcome}`, () => {
      const err = diags(
        `${PANEL}reducer r on=noSuchEffect.${outcome}($v, _) do= n := 1${TAIL}`,
      ).find((e) => e.code === "E0104");
      expect(err, `no E0104 for .${outcome}`).toBeDefined();
      expect(err?.message).toContain("noSuchEffect");
      // At the effect name, which is what a rewrite has to replace.
      expect(`${err?.pos.line}:${err?.pos.col}`).toBe(`3:${"reducer r on=".length + 1}`);
    });
  }

  it("accepts a declared effect", () => {
    const src = `${PANEL}effect load cap=http.get in=Unit out=Result(Text, HttpError)
reducer r on=load.ok($v, _) do= n := 1${TAIL}`;
    expect(codes(src)).not.toContain("E0104");
  });

  for (const outcome of ["ok", "err"]) {
    it(`accepts a built-in effect's .${outcome}`, () => {
      // The runtime registers the built-ins on the same `app.effects` map as a
      // declared effect and reports their results through the same channel, so
      // `on=navigate.ok(...)` does fire.
      expect(
        codes(`${PANEL}reducer r on=navigate.${outcome}(_, _) do= n := 1${TAIL}`),
      ).not.toContain("E0104");
    });
  }
});

describe("app.http handlers (E0102)", () => {
  // One handler per line, so the reported position tells the three apart —
  // on one line every field shares it with the `http` clause's own position,
  // which is the fallback a broken hand-off would produce.
  const app = (on401: string, on403: string, on5xx: string) => `
slot n : Int = 0
tile App = column(text("hi"))
reducer known on=app.start do= n := 1
app A
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []
    http   = {base-url: "/api",
              on-401: ${on401},
              on-403: ${on403},
              on-5xx: ${on5xx}}
`;

  it("reports each undeclared handler at its own name", () => {
    const found = diags(app("noSuchA", "noSuchB", "noSuchC")).filter((e) => e.code === "E0102");
    expect(
      found.map((e) => `${e.pos.line}:${e.pos.col} ${e.message.match(/"(.+)"/)?.[1]}`),
    ).toEqual(["10:23 noSuchA", "11:23 noSuchB", "12:23 noSuchC"]);
  });

  it("accepts declared reducers", () => {
    expect(codes(app("known", "known", "known"))).not.toContain("E0102");
  });
});

const THEMES = `theme Light = {colors: {bg: "#fff"}}
theme Dark = {colors: {bg: "#111"}}
`;

describe("app.theme (E0118)", () => {
  const app = (theme: string, extra = "") => `
tile App = column(text("hi"))
${extra}app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
    theme  = ${theme}
`;

  it("reports a name that is neither a theme nor a slot", () => {
    const err = diags(app("NoSuchTheme")).find((e) => e.code === "E0118");
    expect(err, "no E0118").toBeDefined();
    expect(err?.message).toContain("NoSuchTheme");
    expect(err?.pos.col).toBe(14);
  });

  it("accepts a declared theme", () => {
    expect(codes(app("Light", THEMES))).not.toContain("E0118");
  });

  it("accepts a slot the theme name is read from", () => {
    // `theme = <slot>` is the dynamic form (spec §4.6): the slot holds the
    // name, and switching its value switches the theme.
    expect(codes(app("themeName", `${THEMES}slot themeName : Text = "Light"\n`))).not.toContain(
      "E0118",
    );
  });

  // §4.6 says the slot's *value* must name a declared theme too, and that is
  // deliberately not checked. `65-prefers-dark.kumiki` is why: an app that
  // picks its theme on `app.start` starts the slot at a sentinel that names no
  // theme, because every theme name would be a lie before the choice is made.
  // The sentinel and a misspelling are the same program.
  it("says nothing about the value the slot holds", () => {
    const src = app(
      "themeName",
      `${THEMES}slot themeName : Text = "unset"
tile Btn = button(text="t", onClick=pick)
reducer pick on=ui.click(Btn) do= themeName := "Ligth"
`,
    );
    expect(codes(src)).not.toContain("E0118");
  });
});

describe("app.init effect calls (E0104)", () => {
  // Already resolved, and pinned here because nothing else covers it: `init`
  // goes through the same validation as `emit`, which is what makes the
  // built-in effects legal there.
  it("reports an undeclared effect", () => {
    const src = `
tile App = column(text("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[noSuchEffect()]
`;
    expect(codes(src)).toContain("E0104");
  });
});

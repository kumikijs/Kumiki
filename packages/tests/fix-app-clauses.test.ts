// `kumiki fix --apply` repairs E0001 and E0301 in the app's own clauses, and
// leaves the rest of the file as it was.
//
// errors.md (Auto-patch Coverage) lists both as repaired, and both were text
// patterns that failed on ordinary layouts. E0001's `routes = {` pattern also
// matched a tile's `sub-routes = {`, so a layout tile written above the app got
// the `/404` route and the app kept its E0001. E0001 also defined
// `tile NotFound` when the program already had one, which is E0007. E0301 split
// `caps` on commas and joined it onto one line, so a `# comment` after the last
// cap swallowed the new cap and the closing `]`, and the file stopped parsing.
// The gate refused each write, so `fix --apply` could never repair these files.
//
// Both repairs now find the clause from the tokens of the app the parser found,
// and add the new entry right after the last token of the last entry. The
// redirect and duplicated-clause cases pin that rule where it is easiest to
// get wrong: a redirect's last token is a string, and of two `caps` clauses
// the parser keeps the second.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixCmd } from "@kumikijs/cli";
import { type AppDef, lex, type Program, parse, type TileDef } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-fix-app-clauses-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run `kumiki fix <file> --apply` on `source`; the exit code and the file it left. */
function fixApply(source: string): { code: number; after: string; program: Program } {
  const file = join(dir, "app.kumiki");
  writeFileSync(file, source);
  const code = fixCmd(file, true);
  const after = readFileSync(file, "utf8");
  return { code, after, program: parse(lex(after)) };
}

function appOf(program: Program): AppDef {
  const app = program.defs.find((d): d is AppDef => d.kind === "AppDef");
  if (!app) throw new Error("no app");
  return app;
}

function tilesNamed(program: Program, name: string): TileDef[] {
  return program.defs.filter((d): d is TileDef => d.kind === "TileDef" && d.name === name);
}

describe("E0001: the /404 route goes into the app's routes", () => {
  it("not into the sub-routes of a layout tile written above the app", () => {
    const { code, program } = fixApply(`tile AccountSettings = page(heading("Account settings"))
tile SettingsHome    = page(heading("Settings home"))

tile SettingsLayout
    sub-routes = {
        "/settings/account" -> AccountSettings,
        "/settings"         -> SettingsHome
    }
    = page(heading("Settings"), route-outlet())

tile Landing = page(heading("Landing"))

app NestedRoutes
    caps   = [nav.push]
    routes = {
        "/"            -> Landing,
        "/settings/*"  -> SettingsLayout
    }
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "Landing"],
      ["/settings/*", "SettingsLayout"],
      ["/404", "NotFound"],
    ]);
    const [layout] = tilesNamed(program, "SettingsLayout");
    expect(layout?.subRoutes?.map((r) => [r.path, r.tile])).toEqual([
      ["/settings/account", "AccountSettings"],
      ["/settings", "SettingsHome"],
    ]);
    expect(tilesNamed(program, "NotFound")).toHaveLength(1);
  });

  it("routes to the NotFound tile the program already has, and defines no second one", () => {
    const { code, after, program } = fixApply(`tile NotFound = page(heading("Nothing here"))
tile Landing = page(heading("Landing"))

app A
    caps   = []
    routes = {"/" -> Landing}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "Landing"],
      ["/404", "NotFound"],
    ]);
    expect(tilesNamed(program, "NotFound")).toHaveLength(1);
    expect(after).toContain('tile NotFound = page(heading("Nothing here"))');
  });

  it("after a redirect that is the last route", () => {
    const { code, after, program } = fixApply(`tile Landing = page(heading("Landing"))

app A
    caps   = []
    routes = {"/" -> Landing, "/home" ->> "/"}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).routes.map((r) => [r.path, r.tile])).toEqual([
      ["/", "Landing"],
      ["/home", ">>/"],
      ["/404", "NotFound"],
    ]);
    expect(after).toContain('routes = {"/" -> Landing, "/home" ->> "/", "/404" -> NotFound}');
  });
});

describe("E0301: the capability is a new item of app.caps", () => {
  it("ahead of a comment after the last cap, which stays a comment", () => {
    const { code, after, program } = fixApply(`slot n : Int = 0

effect save cap=storage.write in=Int out=Result(Unit, Text)

reducer bump on=ui.click(Btn) do= emit save(n)

tile Btn = button(text="save")
tile App = column(Btn)

app A
    caps   = [
        nav.push    # links
    ]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    expect(code).toBe(0);
    expect(appOf(program).caps).toEqual(["nav.push", "storage.write"]);
    expect(after).toContain("nav.push, storage.write    # links\n    ]");
  });

  it("in the caps clause the parser keeps, when the clause is written twice", () => {
    // The duplicate is E0008, which no patch repairs, so the file still has an
    // error. What the repair can do is clear the E0301.
    const { code, after, program } = fixApply(`slot n : Int = 0

effect save cap=storage.write in=Int out=Result(Unit, Text)

reducer bump on=ui.click(Btn) do= emit save(n)

tile Btn = button(text="save")
tile App = column(Btn)

app A
    caps   = [nav.push]
    routes = {"/" -> App, "/404" -> App}
    caps   = []
    init   = []
`);
    expect(code).toBe(1);
    expect(appOf(program).caps).toEqual(["storage.write"]);
    expect(after).toContain("caps   = [nav.push]\n");
  });
});

import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withMounted } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

/** The reducers that ran while `src` mounted, in the order they ran. */
async function mountedRun(src: string): Promise<string[]> {
  const episodeLogger = createEpisodeLogger({ memoryMax: 100 });
  return withMounted(
    await loadSource(src),
    async () =>
      episodeLogger
        .list()
        .flatMap((ep) => ep.steps)
        .flatMap((s) => (s.kind === "reducer" ? [s.name] : [])),
    { router: "memory", initialPath: "/", episodeLogger },
  );
}

/** Example 210's tiles: `Account` renders `Settings`, then `Profile`. */
const program = (reducers: string): string =>
  withApp(
    `slot seen : Text = ""
tile Profile  = text("Profile")
tile Settings = text("Settings")
tile Account  = page(Settings, Profile, text("seen: " + seen))
${reducers}`,
    "Account",
  );

describe("tile.mount on several tiles: one reducer per tile", () => {
  it("runs each tile's reducer once on mount, in tree order", async () => {
    const example = readFileSync(feature("210-tile-mount-several-tiles"), "utf8");
    expect(await mountedRun(example)).toEqual(["seeAccount", "seeSettings", "seeProfile"]);
  });

  it.each([
    [
      "runs them in tree order when they are written in tree order",
      `reducer seeAccount  on=tile.mount(Account)  do= seen := seen + "Account "
reducer seeSettings on=tile.mount(Settings) do= seen := seen + "Settings "
reducer seeProfile  on=tile.mount(Profile)  do= seen := seen + "Profile "`,
      ["seeAccount", "seeSettings", "seeProfile"],
    ],
    [
      "runs them in tree order when they are written the other way round",
      `reducer seeProfile  on=tile.mount(Profile)  do= seen := seen + "Profile "
reducer seeSettings on=tile.mount(Settings) do= seen := seen + "Settings "
reducer seeAccount  on=tile.mount(Account)  do= seen := seen + "Account "`,
      ["seeAccount", "seeSettings", "seeProfile"],
    ],
    [
      "runs a second reducer on one tile right after the first, as they are written",
      `reducer seeProfile  on=tile.mount(Profile)  do= seen := seen + "Profile "
reducer seeSettings on=tile.mount(Settings) do= seen := seen + "Settings "
reducer alsoSettings on=tile.mount(Settings) do= seen := seen + "again "`,
      ["seeSettings", "alsoSettings", "seeProfile"],
    ],
  ])("%s", async (_label, reducers, expected) => {
    expect(await mountedRun(program(reducers))).toEqual(expected);
  });

  it("runs a tile's reducer once when the tile renders twice in one render", async () => {
    const src = withApp(
      `slot seen : Text = ""
tile Settings = text("Settings")
tile Account  = page(Settings, Settings, text("seen: " + seen))
reducer seeSettings on=tile.mount(Settings) do= seen := seen + "Settings "`,
      "Account",
    );
    expect(await mountedRun(src)).toEqual(["seeSettings"]);
  });

  it("is E0007 at the second reducer when two share one name", () => {
    const src = program(`reducer seeProfile on=tile.mount(Profile)  do= seen := seen + "Profile "
reducer seeProfile on=tile.mount(Settings) do= seen := seen + "Settings "`);
    const errors = check(parse(lex(src))).filter((d) => d.severity !== "warning");
    expect(errors.map((d) => ({ code: d.code, line: d.pos.line }))).toEqual([
      { code: "E0007", line: 6 },
    ]);
  });
});

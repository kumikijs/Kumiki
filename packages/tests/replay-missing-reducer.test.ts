// An episode whose entry reducer is not in the program fails its
// `episode-test`, whatever the test's `expect` names (testing.md §8.6,
// runtime.md §10.5.3). Example 194's fixture was recorded with the reducer
// named `inc`, and the program names it `bump`. The example's test is run as
// written, through the same compile-and-run path `kumiki test` uses, and again
// with the reducer named `inc`, where the same log replays and the test passes.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import type { EpisodeLogEntry, TestResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "194-replay-missing-reducer.kumiki");
const FIXTURE = EXAMPLE.replace(/\.kumiki$/, ".fixture.jsonl");
const SOURCE = readFileSync(EXAMPLE, "utf8");
const TMP = join(here, ".smoke-tmp", "replay-missing-reducer");

const episodes = readFileSync(FIXTURE, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as EpisodeLogEntry);

/** `replay-renamed`'s result for the program at `path`, without its timing. */
async function replayRenamed(path: string): Promise<Omit<TestResult, "ms">> {
  const results = await testFile(path);
  const { ms: _ms, ...result } = defined(
    results.find((r) => r.name === "replay-renamed"),
    `replay-renamed's result for ${path}`,
  );
  return result;
}

describe("example 194: an episode whose entry reducer is not in the program", () => {
  it("holds one episode, entered by the reducer the program renamed", () => {
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.steps[0]).toMatchObject({ kind: "reducer", name: "inc" });
    expect(SOURCE).toContain("reducer bump on=ui.click(IncBtn)");
    expect(SOURCE).not.toMatch(/reducer inc\b/);
  });

  it("fails `replay-renamed`, naming the episode and the reducer", async () => {
    expect(await replayRenamed(EXAMPLE)).toEqual({
      name: "replay-renamed",
      pass: false,
      expected: "every episode replayed",
      actual: `${episodes[0]?.id}: no reducer named "inc"`,
      diffAt: "episodes",
    });
  });

  it("passes it once the program has a reducer named `inc` again", async () => {
    mkdirSync(TMP, { recursive: true });
    copyFileSync(FIXTURE, join(TMP, basename(FIXTURE)));
    const path = join(TMP, basename(EXAMPLE));
    writeFileSync(path, SOURCE.replace("reducer bump ", "reducer inc "));
    expect(await replayRenamed(path)).toEqual({ name: "replay-renamed", pass: true });
  });
});

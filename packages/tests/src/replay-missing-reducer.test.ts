import { copyFileSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import type { EpisodeLogEntry, TestResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { writeSource } from "./helpers/load.ts";

const EXAMPLE = feature("194-replay-missing-reducer");
const FIXTURE = EXAMPLE.replace(/\.kumiki$/, ".fixture.jsonl");

const [episode] = readFileSync(FIXTURE, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as EpisodeLogEntry);

async function replayRenamed(path: string): Promise<Omit<TestResult, "ms">> {
  const { ms: _ms, ...result } = defined(
    (await testFile(path)).find((r) => r.name === "replay-renamed"),
    `replay-renamed's result for ${path}`,
  );
  return result;
}

describe("an episode-test over a log whose entry reducer the program renamed", () => {
  it("fails, naming the episode and the reducer", async () => {
    expect(await replayRenamed(EXAMPLE)).toEqual({
      name: "replay-renamed",
      pass: false,
      expected: "every episode replayed",
      actual: `${defined(episode, "the fixture's episode").id}: no reducer named "inc"`,
      diffAt: "episodes",
    });
  });

  it("passes once the program has a reducer named `inc` again", async () => {
    const path = writeSource(
      "replay-missing-reducer/194-replay-missing-reducer",
      readFileSync(EXAMPLE, "utf8").replace("reducer bump ", "reducer inc "),
    );
    copyFileSync(FIXTURE, join(dirname(path), basename(FIXTURE)));
    expect(await replayRenamed(path)).toEqual({ name: "replay-renamed", pass: true });
  });
});

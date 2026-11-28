import { copyFileSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { writeSource } from "./helpers/load.ts";
import { editedIn } from "./helpers/source.ts";

const EXAMPLE = feature("286-episode-test-volatile-slot");
const FIXTURE = EXAMPLE.replace(/\.kumiki$/, ".fixture.jsonl");
const SOURCE = readFileSync(EXAMPLE, "utf8");

/** Each test's result for the program at `path`, without its timing. */
async function resultsOf(path: string) {
  return (await testFile(path)).map(({ ms: _ms, ...result }) => result);
}

/** `source` written under `dir`, beside a copy of the example's fixture. */
function besideTheFixture(dir: string, source: string): string {
  const path = writeSource(
    `episode-test-volatile-slot/${dir}/${basename(EXAMPLE, ".kumiki")}`,
    source,
  );
  copyFileSync(FIXTURE, join(dirname(path), basename(FIXTURE)));
  return path;
}

describe("an episode-test over a program that writes a volatile slot", () => {
  it("passes both of the example's tests against the program that recorded the log", async () => {
    expect(await resultsOf(EXAMPLE)).toEqual([
      { name: "replay-from-log", pass: true },
      { name: "replay-names-the-volatile-slot", pass: true },
    ]);
  });

  it.each([
    [
      "`from-log` expects a slot that is not volatile at its default when the log never wrote it",
      "not-volatile",
      "replay-from-log",
      ["slot lastClick"],
      "volatile ",
      "",
    ],
    [
      "a record compares the volatile slot it names",
      "named",
      "replay-names-the-volatile-slot",
      ["test replay-names-the-volatile-slot ="],
      'lastClick: "clicked"',
      'lastClick: ""',
    ],
  ] as const)("%s", async (_, dir, test, anchors, from, to) => {
    const path = besideTheFixture(dir, editedIn(SOURCE, anchors, from, to).source);
    expect((await resultsOf(path)).find((r) => r.name === test)).toMatchObject({
      pass: false,
      expected: '{"count":1,"lastClick":""}',
      diffAt: "slots.lastClick",
      leaf: { expected: "", actual: "clicked" },
    });
  });
});

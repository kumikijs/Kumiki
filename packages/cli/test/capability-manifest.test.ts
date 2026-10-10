import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { feature } from "@kumikijs/examples";
import { beforeEach, describe, expect, it } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { tempDir } from "./helpers/files.ts";

const CUSTOM_CAP_SRC = `slot sent : Int = 0
effect track cap=telemetry.track in={name: Text} out=Unit
reducer fire on=ui.click(B) do= emit track({name: "x"})
tile B = button(text="b")
tile App = column(B, text(sent.show))
app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
`;

it("kumiki smoke runs a file whose capability is declared in kumiki.caps.json", SPAWN, () => {
  const { stdout, code } = runCli(["smoke", feature("27-custom-capability")]);
  expect(code).toBe(0);
  expect(stdout).toContain("ok");
});

describe("kumiki check and the capability manifest", () => {
  /** `<root>/src/app.kumiki`, with `<root>/package.json`. */
  let root: string;
  let source: string;
  beforeEach(() => {
    root = tempDir();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p" }));
    source = join(root, "src", "app.kumiki");
    writeFileSync(source, CUSTOM_CAP_SRC);
  });

  const writeManifest = (capabilities: string[]): string => {
    const manifest = join(root, "kumiki.caps.json");
    writeFileSync(manifest, JSON.stringify({ capabilities }));
    return manifest;
  };

  it("reads a manifest at the project root, not only beside the source", SPAWN, () => {
    writeManifest(["telemetry.track"]);
    const { stdout, code } = runCli(["check", source]);
    expect(code).toBe(0);
    expect(stdout).toContain("ok");
  });

  it.each([["check"], ["build"]])(
    "%s names the directories it searched when there is no manifest",
    SPAWN,
    (verb) => {
      const args = verb === "build" ? [verb, source, join(root, "out")] : [verb, source];
      const { stderr, code } = runCli(args);
      expect(code).toBe(1);
      expect(stderr).toContain("E0302");
      expect(stderr).toContain("no kumiki.caps.json found");
      expect(stderr).toContain(join(root, "src"));
    },
  );

  it("names the manifest it read when that manifest lacks the capability", SPAWN, () => {
    const manifest = writeManifest(["telemetry.identify"]);
    const { stderr, code } = runCli(["check", source]);
    expect(code).toBe(1);
    expect(stderr).toContain("E0302");
    expect(stderr).toContain(manifest);
  });

  it("says nothing about manifests when the diagnostic is not about capabilities", SPAWN, () => {
    writeFileSync(
      source,
      `tile App = column(text(nope))\napp A caps=[] routes={"/" -> App, "/404" -> App} init=[]\n`,
    );
    const { stderr, code } = runCli(["check", source]);
    expect(code).toBe(1);
    expect(stderr).toContain("E0103");
    expect(stderr).not.toContain("kumiki.caps.json");
  });
});

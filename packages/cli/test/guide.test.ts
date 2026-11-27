import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDES, guideTopics, readGuide } from "../src/guide.ts";
import { runCli, SPAWN } from "./helpers/cli.ts";

const here = dirname(fileURLToPath(import.meta.url));

function fixtureRoots(): { guides: string; spec: string } {
  const root = mkdtempSync(join(tmpdir(), "kumiki-guide-"));
  const guides = join(root, "guides");
  const spec = join(root, "spec");
  mkdirSync(guides);
  mkdirSync(spec);
  for (const g of GUIDES) writeFileSync(join(guides, `${g.name}.md`), `# ${g.name} guide\n`);
  writeFileSync(
    join(spec, "errors.md"),
    [
      "# Error Code Specification",
      "",
      "## E00xx — Structure",
      "",
      "### E0001 `missing-404`",
      "",
      "The first entry.",
      "",
      "## E02xx — Types",
      "",
      "### E0201 `type-mismatch`",
      "",
      "A value does not have the type its position requires.",
      "",
      "#### Fix",
      "",
      "Correct the value.",
      "",
      "### E0202 `emit-arg`",
      "",
      "The next entry.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(spec, "language.md"), "# Language Core\n");
  return { guides, spec };
}

describe("readGuide", () => {
  const roots = fixtureRoots();

  it.each(GUIDES.map((g) => g.name))("prints the %s guide", (name) => {
    expect(readGuide(name, roots)).toEqual({ kind: "guide", text: `# ${name} guide\n` });
  });

  it("prints one diagnostic's entry from the error catalog, through its subsections", () => {
    const got = readGuide("E0201", roots);
    expect(got?.kind).toBe("diagnostic");
    expect(got?.text).toBe(
      [
        "### E0201 `type-mismatch`",
        "",
        "A value does not have the type its position requires.",
        "",
        "#### Fix",
        "",
        "Correct the value.",
        "",
      ].join("\n"),
    );
  });

  it("stops an entry at the next band heading as well as at the next entry", () => {
    expect(readGuide("E0001", roots)?.text).toBe("### E0001 `missing-404`\n\nThe first entry.\n");
  });

  it("reads a code in either case", () => {
    expect(readGuide("e0201", roots)).toEqual(readGuide("E0201", roots));
  });

  it("prints a spec document by its name, with or without .md", () => {
    expect(readGuide("language", roots)).toEqual({ kind: "spec", text: "# Language Core\n" });
    expect(readGuide("language.md", roots)).toEqual(readGuide("language", roots));
  });

  it.each(["E9999", "W0000", "nonsense", "../errors"])("has nothing for %s", (topic) => {
    expect(readGuide(topic, roots)).toBeNull();
  });
});

describe("guideTopics", () => {
  it("lists the guides, then the spec documents", () => {
    const roots = fixtureRoots();
    expect(guideTopics(roots)).toEqual({
      guides: GUIDES,
      spec: ["errors", "language"],
    });
  });
});

describe("kumiki guide", () => {
  it("with no topic lists the guides, the spec documents and how to ask for a code", SPAWN, () => {
    const { stdout, code } = runCli(["guide"]);
    expect(code).toBe(0);
    for (const g of GUIDES) expect(stdout).toContain(g.name);
    expect(stdout).toContain("language");
    expect(stdout).toContain("kumiki guide E0201");
  });

  it("prints a diagnostic's entry from the spec this CLI ships with", SPAWN, () => {
    const { stdout, code } = runCli(["guide", "E0103"]);
    expect(code).toBe(0);
    expect(stdout.startsWith("### E0103 ")).toBe(true);
    expect(stdout).not.toContain("### E0104 ");
  });

  it("exits 2 on a topic it does not have, naming the topics it does", SPAWN, () => {
    const { stderr, code } = runCli(["guide", "nonsense"]);
    expect(code).toBe(2);
    expect(stderr).toContain('no guide for "nonsense"');
    expect(stderr).toContain("author");
  });
});

describe("the published build", () => {
  const dist = resolve(here, "..", "dist");

  it.each([
    ["the guides", join(dist, "guides", "author.md")],
    ["the spec", join(dist, "spec", "errors.md")],
  ])("carries %s beside the CLI, where an installed copy reads them", (_what, file) => {
    expect(existsSync(file), `${file} after \`pnpm build\``).toBe(true);
  });
});

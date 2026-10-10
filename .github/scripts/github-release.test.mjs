import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changelogSection, parseTag, releaseBody } from "./github-release.mjs";

const CHANGELOG = `# @kumikijs/compiler

## 0.14.0

### Minor Changes

- aaa1111: First change

  Its explanation. ${"y".repeat(500)}

- bbb2222: Second change ${"z".repeat(500)}

### Patch Changes

- ccc3333: Third change

## 0.13.0

### Minor Changes

- ddd4444: An older change
`;

const URL = "https://github.com/o/r/blob/@kumikijs/compiler@0.14.0/packages/compiler/CHANGELOG.md";

describe("parseTag", () => {
  it("splits a scoped tag at its last @", () => {
    assert.deepEqual(parseTag("@kumikijs/compiler@0.14.0"), {
      name: "@kumikijs/compiler",
      version: "0.14.0",
    });
  });

  it("splits an unscoped tag", () => {
    assert.deepEqual(parseTag("kumiki@0.4.1"), { name: "kumiki", version: "0.4.1" });
  });
});

describe("changelogSection", () => {
  it("takes the version's section, without its heading, up to the next version", () => {
    const s = changelogSection(CHANGELOG, "0.14.0");
    assert.ok(s.startsWith("### Minor Changes"));
    assert.ok(s.includes("ccc3333"));
    assert.ok(!s.includes("ddd4444"));
    assert.ok(!s.includes("## 0.14.0"));
  });

  it("reads the last section to the end of the file", () => {
    assert.ok(changelogSection(CHANGELOG, "0.13.0").includes("ddd4444"));
  });

  it("is undefined for a version the changelog does not have", () => {
    assert.equal(changelogSection(CHANGELOG, "9.9.9"), undefined);
  });
});

describe("releaseBody", () => {
  it("says the package had no changes of its own when its section is empty", () => {
    const expected =
      "Released at the same version as the other Kumiki packages, with no changes of its own.";
    assert.equal(releaseBody("", URL), expected);
    const bumpedOnly = changelogSection("## 0.15.0\n\n## 0.14.0\n\n- abc1234: Older\n", "0.15.0");
    assert.equal(releaseBody(bumpedOnly, URL), expected);
    assert.equal(releaseBody("### Patch Changes\n", URL), expected);
  });

  it("is the whole section when it fits", () => {
    const section = changelogSection(CHANGELOG, "0.14.0");
    assert.equal(releaseBody(section, URL, 10_000), section);
  });

  it("cuts at an entry boundary and links the full changelog when it does not fit", () => {
    const section = changelogSection(CHANGELOG, "0.14.0");
    const limit = section.indexOf("- bbb2222") + 400;
    const body = releaseBody(section, URL, limit);
    assert.ok(body.length <= limit, `${body.length} > ${limit}`);
    assert.ok(body.includes("aaa1111"));
    assert.ok(body.includes("Its explanation."));
    assert.ok(!body.includes("ccc3333"));
    assert.ok(body.includes(URL));
  });

  it("never splits an entry, even when the limit falls inside the first one", () => {
    const section = changelogSection(CHANGELOG, "0.14.0");
    const body = releaseBody(section, URL, 300);
    assert.ok(body.length <= 300);
    assert.ok(!body.includes("aaa1111"));
    assert.ok(!body.includes("###"));
    assert.ok(body.includes(URL));
  });

  it("fits GitHub's limit for a section far over it", () => {
    const entry = `- abc1234: ${"x".repeat(1000)}\n\n`;
    const section = `### Minor Changes\n\n${entry.repeat(200)}`;
    const body = releaseBody(section, URL);
    assert.ok(section.length > 125_000);
    assert.ok(body.length <= 125_000);
    assert.ok(body.includes(URL));
  });
});

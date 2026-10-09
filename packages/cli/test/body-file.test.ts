import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { seed } from "./helpers/files.ts";

const SOURCE = `slot count : Int = 0
tile App = column(heading("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

let target: string;
/** Write `content` beside the target; its path. */
let beside: (name: string, content: string) => string;
beforeEach(() => {
  target = seed(SOURCE);
  beside = (name, content) => {
    const file = join(dirname(target), name);
    writeFileSync(file, content);
    return file;
  };
});

describe("reading a body or a patch from a file", () => {
  it("add --body-file reads <path>, keeping newlines and multi-space runs", SPAWN, () => {
    const bodyFile = beside("body.txt", "Int\n    =    0");
    const { out, code } = runCli(["add", target, "slot", "total", "--body-file", bodyFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/added slot\.total/);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("slot total");
    expect(after).toContain("Int\n    =    0");
  });

  it("replace --body-file reads <path>, keeping whitespace", SPAWN, () => {
    const bodyFile = beside("body.txt", "Int\n    =    42");
    const { out, code } = runCli(["replace", target, "slot.count", "--body-file", bodyFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/replaced slot\.count/);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("Int\n    =    42");
    expect(after).not.toContain(": Int = 0");
  });

  it.each([
    ["add", ["slot", "total"], "Int\n  = 0", /added slot\.total/],
    ["replace", ["slot.count"], "Int\n    =    77", /replaced slot\.count/],
  ])("%s --body-file - reads stdin", SPAWN, (verb, args, body, reported) => {
    const { out, code } = runCli([verb, target, ...args, "--body-file", "-"], { input: body });
    expect(code).toBe(0);
    expect(out).toMatch(reported);
    expect(readFileSync(target, "utf8")).toContain(body);
  });

  it("edit --patch-file loads the patch JSON from <path>", SPAWN, () => {
    const patchFile = beside(
      "patch.json",
      JSON.stringify({ find: "Int = 0", replace: "Int = 100" }),
    );
    const { out, code } = runCli(["edit", target, "slot.count", "--patch-file", patchFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/edited slot\.count/);
    expect(readFileSync(target, "utf8")).toContain("Int = 100");
  });
});

describe("refusing a body or a patch given ambiguously", () => {
  it.each([
    ["add", ["slot", "total", "Int", "=", "0"], "--body-file", "Int = 0"],
    ["replace", ["slot.count", "Int", "=", "42"], "--body-file", "Int = 42"],
    [
      "edit",
      ["slot.count", '{"find":"Int = 0","replace":"Int = 200"}'],
      "--patch-file",
      JSON.stringify({ find: "Int = 0", replace: "Int = 100" }),
    ],
  ])("%s exits 2 when a positional and %s are both given", SPAWN, (verb, args, flag, content) => {
    const { out, code } = runCli([verb, target, ...args, flag, beside("input", content)]);
    expect(code).toBe(2);
    expect(out).toMatch(/mutually exclusive/);
    expect(out).toMatch(new RegExp(`Usage: kumiki ${verb}`));
    expect(readFileSync(target, "utf8")).toBe(SOURCE);
  });

  it.each([
    ["add", ["slot", "total"], "--body-file"],
    ["replace", ["slot.count"], "--body-file"],
    ["edit", ["slot.count"], "--patch-file"],
  ])("%s exits 2 when %s is followed by another flag", SPAWN, (verb, args, flag) => {
    const { out, code } = runCli([verb, target, ...args, flag, "--strict-a11y"]);
    expect(code).toBe(2);
    expect(out).toMatch(new RegExp(`Usage: kumiki ${verb}`));
  });

  it("add exits 2 when neither --body-file nor a positional body is given", SPAWN, () => {
    const { out, code } = runCli(["add", target, "slot", "total"]);
    expect(code).toBe(2);
    expect(out).toMatch(/Usage: kumiki add/);
  });

  it("add exits 2 with a named error when --body-file points at a missing path", SPAWN, () => {
    const missing = join(dirname(target), "does-not-exist.txt");
    const { out, code } = runCli(["add", target, "slot", "total", "--body-file", missing]);
    expect(code).toBe(2);
    expect(out).toMatch(/--body-file/);
    expect(out).toMatch(/cannot read/);
  });

  it("edit names --patch-file in the error when the file's JSON is invalid", SPAWN, () => {
    const patchFile = beside("broken.json", "{ not valid json");
    const { out, code } = runCli(["edit", target, "slot.count", "--patch-file", patchFile]);
    expect(code).toBe(2);
    expect(out).toMatch(/invalid JSON in --patch-file/);
    expect(out).toContain(patchFile);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.ts";

/** Run the CLI, capturing stdout+stderr and the exit code without throwing. */
const SEED_SRC = `tile App = column(heading("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

describe("kumiki add --body-file", () => {
  let dir: string;
  let target: string;
  let bodyFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-body-file-"));
    target = join(dir, "app.kumiki");
    bodyFile = join(dir, "body.txt");
    writeFileSync(target, SEED_SRC);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the body from <path> and preserves newlines and multi-space runs", {
    timeout: 30000,
  }, () => {
    // The positional-body join would collapse this to a single-space run.
    writeFileSync(bodyFile, "Int\n    =    0");
    const { out, code } = runCli(["add", target, "slot", "count", "--body-file", bodyFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/added slot\.count/);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("Int\n    =    0");
    expect(after).toContain("slot count");
  });

  it("reads the body from stdin when --body-file is '-'", { timeout: 30000 }, () => {
    const { out, code } = runCli(["add", target, "slot", "count", "--body-file", "-"], {
      input: "Int\n  = 0",
    });
    expect(code).toBe(0);
    expect(out).toMatch(/added slot\.count/);
    expect(readFileSync(target, "utf8")).toContain("Int\n  = 0");
  });

  it("exits 2 when --body-file and a positional body are given together", {
    timeout: 30000,
  }, () => {
    writeFileSync(bodyFile, "Int = 0");
    const { out, code } = runCli([
      "add",
      target,
      "slot",
      "count",
      "Int",
      "=",
      "0",
      "--body-file",
      bodyFile,
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/mutually exclusive/);
    expect(out).toMatch(/Usage: kumiki add/);
  });

  it("exits 2 when neither --body-file nor a positional body is given", { timeout: 30000 }, () => {
    const { out, code } = runCli(["add", target, "slot", "count"]);
    expect(code).toBe(2);
    expect(out).toMatch(/Usage: kumiki add/);
  });

  it("exits 2 when --body-file's next token is another flag", { timeout: 30000 }, () => {
    const { out, code } = runCli(["add", target, "slot", "count", "--body-file", "--strict-a11y"]);
    expect(code).toBe(2);
    expect(out).toMatch(/Usage: kumiki add/);
  });

  it("exits 2 with a named error when --body-file points at a missing path", {
    timeout: 30000,
  }, () => {
    const { out, code } = runCli([
      "add",
      target,
      "slot",
      "count",
      "--body-file",
      join(dir, "does-not-exist.txt"),
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/--body-file/);
    expect(out).toMatch(/cannot read/);
  });
});

describe("kumiki replace --body-file", () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-body-file-"));
    target = join(dir, "app.kumiki");
    writeFileSync(
      target,
      `slot count : Int = 0
tile App = column(heading("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the replacement body from <path> and preserves whitespace", { timeout: 30000 }, () => {
    const bodyFile = join(dir, "body.txt");
    writeFileSync(bodyFile, "Int\n    =    42");
    const { out, code } = runCli(["replace", target, "slot.count", "--body-file", bodyFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/replaced slot\.count/);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("Int\n    =    42");
    expect(after).not.toContain(": Int = 0");
  });

  it("exits 2 when --body-file and a positional body are given together", {
    timeout: 30000,
  }, () => {
    const bodyFile = join(dir, "body.txt");
    writeFileSync(bodyFile, "Int = 42");
    const { out, code } = runCli([
      "replace",
      target,
      "slot.count",
      "Int",
      "=",
      "42",
      "--body-file",
      bodyFile,
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/mutually exclusive/);
    expect(out).toMatch(/Usage: kumiki replace/);
  });

  it("reads the replacement body from stdin when --body-file is '-'", { timeout: 30000 }, () => {
    const { out, code } = runCli(["replace", target, "slot.count", "--body-file", "-"], {
      input: "Int\n    =    77",
    });
    expect(code).toBe(0);
    expect(out).toMatch(/replaced slot\.count/);
    expect(readFileSync(target, "utf8")).toContain("Int\n    =    77");
  });
});

describe("kumiki edit --patch-file", () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-patch-file-"));
    target = join(dir, "app.kumiki");
    writeFileSync(
      target,
      `slot count : Int = 0
tile App = column(heading("hi"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads the patch JSON from <path>", { timeout: 30000 }, () => {
    const patchFile = join(dir, "patch.json");
    // editDef accepts either {find, replace} or per-line {"body:<n>": "replace 'a' -> 'b'"}.
    writeFileSync(patchFile, JSON.stringify({ find: "Int = 0", replace: "Int = 100" }));
    const { out, code } = runCli(["edit", target, "slot.count", "--patch-file", patchFile]);
    expect(code).toBe(0);
    expect(out).toMatch(/edited slot\.count/);
    expect(readFileSync(target, "utf8")).toContain("Int = 100");
  });

  it("exits 2 when --patch-file and a positional patch-json are both given", {
    timeout: 30000,
  }, () => {
    const patchFile = join(dir, "patch.json");
    writeFileSync(patchFile, JSON.stringify({ find: "Int = 0", replace: "Int = 100" }));
    const { out, code } = runCli([
      "edit",
      target,
      "slot.count",
      '{"find":"Int = 0","replace":"Int = 200"}',
      "--patch-file",
      patchFile,
    ]);
    expect(code).toBe(2);
    expect(out).toMatch(/mutually exclusive/);
    expect(out).toMatch(/Usage: kumiki edit/);
  });

  it("names --patch-file in the error when the file's JSON is invalid", { timeout: 30000 }, () => {
    const patchFile = join(dir, "broken.json");
    writeFileSync(patchFile, "{ not valid json");
    const { out, code } = runCli(["edit", target, "slot.count", "--patch-file", patchFile]);
    expect(code).toBe(2);
    expect(out).toMatch(/invalid JSON in --patch-file/);
    expect(out).toContain(patchFile);
  });
});

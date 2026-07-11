// AC for #163: kumiki add/replace grow --body-file <path>, and edit grows
// --patch-file <path>. Positional body is joined with a single space, so a
// multi-line definition round-tripped through the shell collapses. --body-file
// reads the file (or stdin, when path is "-") verbatim so tabs / newlines /
// multi-space runs survive.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(here, "../src/kumiki.ts");

/** Run the CLI, capturing stdout+stderr and the exit code without throwing. */
function runCli(args: string[], input?: string): { out: string; code: number } {
  if (input !== undefined) {
    const res = spawnSync("npx", ["tsx", CLI_PATH, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      encoding: "utf8",
      input,
    });
    return {
      out: `${res.stdout ?? ""}${res.stderr ?? ""}`,
      code: res.status ?? (res.error ? 1 : 0),
    };
  }
  try {
    const out = execFileSync("npx", ["tsx", CLI_PATH, ...args], {
      stdio: "pipe",
      shell: true,
      encoding: "utf8",
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? 1 };
  }
}

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
    const { out, code } = runCli(
      ["add", target, "slot", "count", "--body-file", "-"],
      "Int\n  = 0",
    );
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
});

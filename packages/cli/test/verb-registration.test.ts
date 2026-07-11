// Regression test locking that every verb is wired into the commander program.
// Without this, dropping a `registerX(program)` line in kumiki.ts silently
// removes a verb from the CLI — every ai-edit.test.ts case still passes
// because it targets the library API directly (`addDef` etc.), so the CLI
// dispatch layer would never be exercised.
//
// For each verb we assert:
//   1. `kumiki <verb> --help` exits 0 and mentions the verb name (proves the
//      subcommand is registered).
//   2. Missing required args produce a Usage line and exit 2 (proves the
//      per-verb USAGE constant survived the refactor).

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(here, "../src/kumiki.ts");

function runCli(args: string[]): { out: string; code: number } {
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

// Verbs whose CLI wiring has no dedicated regression elsewhere.
// build / check / smoke / dev / test / run / replay / add / replace / edit / fix
// are already covered by cli.test.ts, dev.test.ts, body-file.test.ts, etc.
const VERBS = ["list", "view", "refs", "remove", "rename", "lock", "unlock", "patch"];

describe("verb registration smoke", () => {
  for (const verb of VERBS) {
    it(`${verb} exposes --help (proves the verb is registered)`, { timeout: 30000 }, () => {
      const { out, code } = runCli([verb, "--help"]);
      expect(code).toBe(0);
      expect(out).toContain(`kumiki ${verb}`);
    });

    it(`${verb} exits 2 on missing required args (proves USAGE survived the refactor)`, {
      timeout: 30000,
    }, () => {
      const { out, code } = runCli([verb]);
      expect(code).toBe(2);
      // `patch` is a group command; its own bare help lands here.
      expect(out).toMatch(new RegExp(`kumiki ${verb}`));
    });
  }
});

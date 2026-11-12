// @vitest-environment node
//
// `node:fs` is wrapped so that cutting a skipped last line off the op log fails, the way a log that
// can be read but not written fails it. Under happy-dom, Vitest does not route a module's named
// `node:fs` imports through `vi.mock`.

import { appendFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTER, call, callTool, errorMessage, useWorkdir, withClient } from "./helpers/client.ts";

const fault = vi.hoisted(() => ({
  /** Cutting a skipped last line off the op log fails. */
  cutOff: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    truncateSync: (...args: Parameters<typeof fs.truncateSync>): void => {
      if (fault.cutOff && String(args[0]).endsWith(".kumiki-ops.jsonl")) {
        throw Object.assign(new Error(`EIO: i/o error, open '${String(args[0])}'`), {
          code: "EIO",
          syscall: "open",
        });
      }
      fs.truncateSync(...args);
    },
  };
});

/** The start of an op-log line, cut off mid-key. */
const TORN = '{"op":"replace","layer":"slot","na';

describe("an edit tool that reads a torn last line and then fails", () => {
  const workdir = useWorkdir();
  let file: string;
  let log: string;
  beforeEach(() => {
    fault.cutOff = false;
    file = join(workdir.path, "counter.kumiki");
    log = `${file}.kumiki-ops.jsonl`;
    copyFileSync(COUNTER, file);
  });
  afterEach(() => {
    fault.cutOff = false;
  });

  it("follows its error with the skipped line, which the error does not name", async () => {
    await withClient(async (client) => {
      await callTool(client, "kumiki_replace", { path: file, name: "slot.count", body: "N = 1" });
      appendFileSync(log, TORN);
      fault.cutOff = true;

      const res = await call(client, "kumiki_replace", {
        path: file,
        name: "slot.count",
        body: "N = 5",
      });

      expect(res.isError).toBe(true);
      expect(res.items).toHaveLength(2);
      const [error = "", warnings = ""] = res.items;
      expect(errorMessage(error)).toBe(
        `replace rejected: the op could not be logged (EIO: i/o error, open '${log}'); the file was restored and nothing was written`,
      );
      expect(warnings.startsWith("warnings:\n")).toBe(true);
      expect(JSON.parse(warnings.slice("warnings:\n".length))).toEqual([
        {
          kind: "malformed-jsonl",
          message: `${log}:2: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it`,
        },
      ]);
    });
  });
});

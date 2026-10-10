import * as fs from "node:fs";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { callOnce, FIX_COUNTER_TYPO, flag, useWorkdir } from "./helpers/client.ts";

// A plain-object namespace, so `vi.spyOn(fs, ...)` can replace an export.
vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

type Applied = {
  applied: number;
  before: string;
  after: string;
  remaining: unknown[];
  warnings: { code: string }[];
  writeError?: string;
  regressionBlocked?: boolean;
  parseError?: string;
};

describe("kumiki_fix", () => {
  const workdir = useWorkdir();
  const typoCopy = (): string => {
    const file = join(workdir.path, "typo.kumiki");
    copyFileSync(FIX_COUNTER_TYPO, file);
    return file;
  };

  it("in dry-run proposes the patch, flags the file as still broken, and writes nothing", async () => {
    const file = typoCopy();
    const original = readFileSync(file, "utf8");
    const res = await callOnce("kumiki_fix", { path: file });
    expect(res.isError).toBe(true);
    expect(res.body).toContain("E0103");
    expect(res.body).toContain("conut");
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("proposes no rename for a read before the scope that declares the name", async () => {
    // `idx` is one edit from the slot `id`; renamed, the first `text` would read the slot.
    const file = join(workdir.path, "before-scope.kumiki");
    const source = [
      "slot id : Int = 0",
      "slot xs : List(Int) = [1, 2]",
      "tile App = column(text(idx.show), for idx in xs text(idx.show))",
      'app M caps=[] routes={"/" -> App, "/404" -> App} init=[]',
      "",
    ].join("\n");
    writeFileSync(file, source);
    const res = await callOnce("kumiki_fix", { path: file });
    expect(res.body.split("\n")).toEqual([
      "(no auto-patches available)",
      `E0103 Reference to undefined name "idx" — it is declared later, at 3:35, and scoped to a tile's "for" body: move the read into the body (see docs/spec/language.md)`,
    ]);
    expect(readFileSync(file, "utf8")).toBe(source);
  });

  it("with apply:true writes the patch, returns before/after, and leaves the file clean", async () => {
    const file = typoCopy();
    const res = await callOnce("kumiki_fix", { path: file, apply: true });
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.body) as Applied;
    expect(parsed.applied).toBeGreaterThan(0);
    expect(parsed.before).toContain("conut");
    expect(parsed.after).not.toContain("conut");
    expect(parsed.after).toContain("count := count + 1");
    expect(parsed.remaining).toEqual([]);
    expect(readFileSync(file, "utf8")).not.toContain("conut");
    expect(await flag("kumiki_fix", { path: file })).toBe(false);
  });

  it("flags an apply that leaves errors no rule repairs", async () => {
    const partial = join(workdir.path, "partial.kumiki");
    writeFileSync(
      partial,
      `${readFileSync(FIX_COUNTER_TYPO, "utf8")}\ntile Orphan = column(zzz.show)\n`,
    );
    expect(await flag("kumiki_fix", { path: partial, apply: true })).toBe(true);
  });

  it("`only` narrows planning to a single diagnostic code", async () => {
    const file = typoCopy();
    const filtered = await callOnce("kumiki_fix", { path: file, only: "E9999" });
    expect(filtered.body).toContain("(no auto-patches available)");
    expect(filtered.body).toContain("E0103");
    const targeted = await callOnce("kumiki_fix", { path: file, only: "E0103" });
    expect(targeted.body).toContain("E0103");
    expect(targeted.body).toContain("conut");
  });

  it("puts the warnings on the wire when applying, where `remaining` is empty", async () => {
    const file = join(workdir.path, "reveals-warning.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer bump on=ui.focus(Crd) do= count := count + 1",
        'tile Card = box(heading("Count: " + count.show))',
        "tile App = column(Card)",
        "app Demo",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const parsed = JSON.parse((await callOnce("kumiki_fix", { path: file, apply: true })).body);
    expect(parsed).toMatchObject({ applied: 1, remaining: [] });
    expect((parsed as Applied).warnings.map((w) => w.code)).toEqual(["W0212"]);
  });

  it("apply-mode surfaces writeError on the wire when the on-disk write throws", async () => {
    const file = typoCopy();
    const before = readFileSync(file, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EACCES: simulated for kumiki_fix wire");
    });
    try {
      const res = await callOnce("kumiki_fix", { path: file, apply: true });
      const parsed = JSON.parse(res.body) as Applied;
      expect(parsed.applied).toBe(0);
      expect(parsed.writeError).toContain("EACCES");
      expect(parsed.regressionBlocked).toBeUndefined();
      expect(parsed.parseError).toBeUndefined();
    } finally {
      writeSpy.mockRestore();
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

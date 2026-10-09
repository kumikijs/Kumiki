import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { ensureDom, smokeFile } from "../src/smoke.ts";

const BLOG = app("03-blog");

describe("a smoke run starts from empty storage", () => {
  it("does not restore a value another app left under the same key", async () => {
    await ensureDom();
    localStorage.setItem("session", JSON.stringify({ email: "a@example.com" }));
    sessionStorage.setItem("leftover", "1");

    const report = await smokeFile(BLOG);

    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(sessionStorage.getItem("leftover")).toBeNull();
  }, 30_000);
});

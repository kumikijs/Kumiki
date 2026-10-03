import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listApps, measureApp } from "./measure.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("listApps", () => {
  it("finds every example app, in name order", () => {
    const apps = listApps(ROOT);
    expect(apps[0]?.name).toBe("01-counter");
    expect(apps.map((a) => a.name)).toEqual([...apps.map((a) => a.name)].sort());
  });
});

describe("measureApp", () => {
  it("measures the counter as the CLI builds it", { timeout: 60_000 }, () => {
    const counter = listApps(ROOT).find((a) => a.name === "01-counter");
    const m = measureApp(ROOT, counter);
    expect(m.name).toBe("01-counter");
    // The modular layout ships app.js beside the runtime modules it imports;
    // the counter's own code is a few KB, the rest is runtime/.
    expect(m.modular.files).toBeGreaterThan(1);
    expect(m.runtime).toBeGreaterThan(m.modular.raw / 2);
    expect(m.runtime).toBeLessThan(m.modular.raw);
    // One compression stream over the linked file beats one per module, and
    // linking tree-shakes what the module boundary hid — so the bundle is
    // smaller on every axis. A bundle that is not would mean `--bundle`
    // stopped linking.
    expect(m.bundle.raw).toBeLessThan(m.modular.raw);
    expect(m.bundle.gzip).toBeLessThan(m.modular.gzip);
    expect(m.bundle.brotli).toBeLessThan(m.bundle.gzip);
  });
});

// `kumiki build --minify` (opt-in). The flag exists because the readable
// default is load-bearing and must stay the default: the AI debug loop reads
// `app.js` stack traces, and the harnesses patch two of codegen's emitted
// lines by verbatim string replace. So the cases below pin both halves — that
// a plain build is still the readable artifact those depend on, and that the
// minified one is smaller *and* still a working app, not just smaller.
//
// `runtime/` is deliberately out of scope for the flag: those modules ship
// minified from the runtime's own build, and re-minifying a minified file is
// work with nothing to show for it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_ARGV } from "./helpers/cli.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER_PATH = resolve(here, "../../examples/apps/01-counter/app.kumiki");

describe("kumiki build --minify", () => {
  let plainDir: string;
  let minDir: string;

  beforeEach(() => {
    plainDir = mkdtempSync(join(tmpdir(), "kumiki-plain-"));
    minDir = mkdtempSync(join(tmpdir(), "kumiki-min-"));
  });

  afterEach(() => {
    for (const d of [plainDir, minDir]) rmSync(d, { recursive: true, force: true });
  });

  function build(outDir: string, ...flags: string[]): string {
    return execFileSync(process.execPath, [...CLI_ARGV, "build", COUNTER_PATH, outDir, ...flags], {
      stdio: "pipe",
      encoding: "utf8",
    });
  }

  it("is off by default — app.js keeps the spelling the harnesses patch", () => {
    build(plainDir);
    const js = readFileSync(join(plainDir, "app.js"), "utf8");
    // codegen calls these two lines load-bearing: build-and-load.ts,
    // tests/helpers/load.ts and e2e/src/browser.ts string-replace them.
    expect(js).toContain("const App = createApp();");
    expect(js).toContain("globalThis.__kumikiApp = App;");
    // Readable, not a handful of very long lines.
    expect(js.split("\n").length).toBeGreaterThan(100);
  });

  it("--minify writes a much smaller app.js", () => {
    build(plainDir);
    const out = build(minDir, "--minify");
    expect(out).toContain("(minified)");
    const plain = statSync(join(plainDir, "app.js")).size;
    const minified = statSync(join(minDir, "app.js")).size;
    // The counter measures ~55%; assert a floor well clear of noise rather
    // than the exact ratio, which moves with every codegen change.
    expect(minified).toBeLessThan(plain * 0.75);
  });

  it("--minify changes app.js and nothing else", () => {
    build(plainDir);
    build(minDir, "--minify");
    const listing = (d: string): string[] =>
      readdirSync(d, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name).slice(d.length + 1))
        .sort();
    expect(listing(minDir)).toEqual(listing(plainDir));
    for (const f of listing(plainDir)) {
      if (f === "app.js") continue;
      expect(readFileSync(join(minDir, f), "utf8"), `${f} differs`).toBe(
        readFileSync(join(plainDir, f), "utf8"),
      );
    }
  });

  it("--bundle writes one app.js and no runtime/", () => {
    const out = build(minDir, "--bundle");
    expect(out).toContain("bundled");
    expect(existsSync(join(minDir, "app.js"))).toBe(true);
    expect(existsSync(join(minDir, "index.html"))).toBe(true);
    expect(existsSync(join(minDir, "runtime"))).toBe(false);
    // The linked file carries no unresolved relative import — a leftover
    // `./runtime/core.js` would 404 with `runtime/` gone.
    expect(readFileSync(join(minDir, "app.js"), "utf8")).not.toContain("./runtime/");
  });

  it("--bundle is smaller than the modular build it replaces, raw and compressed", () => {
    build(plainDir);
    build(minDir, "--bundle");
    const modularFiles = [
      join(plainDir, "app.js"),
      ...readdirSync(join(plainDir, "runtime")).map((f) => join(plainDir, "runtime", f)),
    ];
    const bundledFile = join(minDir, "app.js");
    const raw = (fs: string[]): number => fs.reduce((n, f) => n + statSync(f).size, 0);
    // Compressed separately per file, which is what the wire does: gzip and
    // brotli build their dictionary per response, so eight small modules
    // compress markedly worse than the same bytes linked together. That is
    // most of why bundling wins by more after compression than before.
    const gz = (fs: string[]): number =>
      fs.reduce((n, f) => n + gzipSync(readFileSync(f), { level: 9 }).length, 0);
    expect(raw([bundledFile])).toBeLessThan(raw(modularFiles) * 0.95);
    expect(gz([bundledFile])).toBeLessThan(gz(modularFiles) * 0.9);
  });

  it("--minify --bundle is --bundle — the flags do not fight", () => {
    // `--bundle` implies minification, so the pair has to resolve to exactly
    // the bundled artifact. Without this, inverting the precedence expression
    // in `buildCmd` (minifying first and then linking the minified module, or
    // skipping the link) fails nothing: both paths still emit an `app.js` that
    // mounts, one of them just larger and with a stray `runtime/`.
    build(plainDir, "--bundle");
    build(minDir, "--minify", "--bundle");
    expect(existsSync(join(minDir, "runtime"))).toBe(false);
    expect(readFileSync(join(minDir, "app.js"), "utf8")).toBe(
      readFileSync(join(plainDir, "app.js"), "utf8"),
    );
  });

  it("the bundled counter still mounts and survives a click", async () => {
    build(minDir, "--bundle");
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      await import(pathToFileURL(join(minDir, "app.js")).href);
      expect(root.textContent).toContain("Count: 0");
      const incBtn = [...root.querySelectorAll("button")].find((b) => b.textContent === "+");
      incBtn?.click();
      expect(root.textContent).toContain("Count: 1");
      expect((globalThis as { __kumikiApp?: unknown }).__kumikiApp).toBeDefined();
    } finally {
      root.remove();
    }
  });

  it("the minified counter still mounts and survives a click", async () => {
    build(minDir, "--minify");
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      await import(pathToFileURL(join(minDir, "app.js")).href);
      expect(root.textContent).toContain("Count: 0");
      const incBtn = [...root.querySelectorAll("button")].find((b) => b.textContent === "+");
      incBtn?.click();
      expect(root.textContent).toContain("Count: 1");
      // The state oracle the smoke / scenario / e2e harnesses read survives
      // minification — it is a property name, not a binding.
      expect((globalThis as { __kumikiApp?: unknown }).__kumikiApp).toBeDefined();
    } finally {
      root.remove();
    }
  });
});

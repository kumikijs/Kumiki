import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { app, feature } from "@kumikijs/examples";
import { describe, expect, it, onTestFinished } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
import { tempDir } from "./helpers/files.ts";

const COUNTER = app("01-counter");

/** `kumiki build <input>` into a fresh directory; that directory and what the build printed. */
function build(input: string, ...flags: string[]): { outDir: string; stdout: string } {
  const outDir = tempDir();
  const { stdout, stderr, code } = runCli(["build", input, outDir, ...flags]);
  if (code !== 0) throw new Error(`kumiki build exited ${code}:\n${stderr}`);
  return { outDir, stdout };
}

/** Import the built app.js against a fresh `#root`; the root it rendered into. */
async function mountBuilt(outDir: string): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  onTestFinished(() => root.remove());
  await import(pathToFileURL(join(outDir, "app.js")).href);
  return root;
}

const clickPlus = (root: HTMLElement): void => {
  [...root.querySelectorAll("button")].find((b) => b.textContent === "+")?.click();
};

describe("kumiki build ships only the runtime modules an app uses", () => {
  it("counter ships index.html, app.js, and only its runtime modules", SPAWN, () => {
    const { outDir } = build(COUNTER);
    expect(existsSync(join(outDir, "runtime.js"))).toBe(false);
    const expected = [
      "core.js",
      "stdlib.js",
      "tiles-layout.js",
      "tiles-text-heading.js",
      "tiles-input-button.js",
      "tiles-input-shared.js",
    ];
    for (const f of expected) {
      expect(existsSync(join(outDir, "runtime", f)), `runtime/${f} missing`).toBe(true);
    }
    for (const f of [
      "router.js",
      "testkit.js",
      "effects-storage.js",
      "effects-http.js",
      "effects-toast.js",
      "effects-confirm.js",
      "tiles-text.js",
      "tiles-text-link.js",
      "tiles-text-icon.js",
      "tiles-input.js",
      "tiles-input-select.js",
      "tiles-input-textarea.js",
      "tiles-collection.js",
      "tiles-overlay.js",
      "tiles-media.js",
      "tiles-status.js",
    ]) {
      expect(existsSync(join(outDir, "runtime", f)), `runtime/${f} should not ship`).toBe(false);
    }

    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/app.js"></script>');

    const appJs = readFileSync(join(outDir, "app.js"), "utf8");
    expect(appJs).toContain('import { mountCore } from "./runtime/core.js"');
    expect(appJs).toContain('tile: "IncBtn"');
    expect(appJs).toContain('_h("inc")');

    const total = expected
      .map((f) => readFileSync(join(outDir, "runtime", f)).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(65_000);
    expect(readFileSync(join(outDir, "runtime", "core.js"), "utf8")).not.toContain(": AppShape");
  });

  it(
    "the built counter mounts and patches in place — the heading survives a bump",
    SPAWN,
    async () => {
      const root = await mountBuilt(build(COUNTER).outDir);
      const heading = root.querySelector("h1") as HTMLElement;
      expect(heading.textContent).toContain("Count: 0");
      heading.dataset.probe = "seeded";
      clickPlus(root);
      expect(root.textContent).toContain("Count: 1");
      expect(root.querySelector("h1")).toBe(heading);
      expect(heading.dataset.probe).toBe("seeded");
    },
  );

  it("the built input keeps its element across a bound-value change", SPAWN, async () => {
    const root = await mountBuilt(build(feature("13-text-input-bind")).outDir);
    const input = root.querySelector("input") as HTMLInputElement;
    input.dataset.probe = "seeded";
    input.value = "ada";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.textContent).toContain("Hello, ada");
    expect(root.querySelector("input")).toBe(input);
    expect(input.dataset.probe).toBe("seeded");
  });

  it("a routing app ships router.js and the built artifact navigates", SPAWN, async () => {
    const { outDir } = build(feature("18-routing"));
    expect(existsSync(join(outDir, "runtime", "router.js"))).toBe(true);
    const mountOptions = globalThis as { __kumikiMount?: unknown };
    mountOptions.__kumikiMount = { router: "memory" };
    onTestFinished(() => {
      delete mountOptions.__kumikiMount;
    });
    const root = await mountBuilt(outDir);
    expect(root.textContent).toContain("Home");
    (root.querySelector('[data-kumiki-tile="link"]') as HTMLAnchorElement).click();
    expect(root.textContent).toContain("Item 42");
  });

  it("a storage app ships effects-storage.js and no http module", SPAWN, () => {
    const { outDir } = build(feature("20-effect-storage"));
    expect(existsSync(join(outDir, "runtime", "effects-storage.js"))).toBe(true);
    expect(existsSync(join(outDir, "runtime", "effects-http.js"))).toBe(false);
    expect(readFileSync(join(outDir, "app.js"), "utf8")).toContain(
      'from "./runtime/effects-storage.js"',
    );
  });
});

describe("kumiki build --minify / --bundle", () => {
  const files = (d: string): string[] =>
    readdirSync(d, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(d.length + 1))
      .sort();

  it("is off by default — app.js keeps the spelling the harnesses patch", SPAWN, () => {
    const js = readFileSync(join(build(COUNTER).outDir, "app.js"), "utf8");
    expect(js).toContain("const App = createApp();");
    expect(js).toContain("globalThis.__kumikiApp = App;");
    expect(js.split("\n").length).toBeGreaterThan(100);
  });

  it("--minify writes a much smaller app.js and changes nothing else", SPAWN, () => {
    const plain = build(COUNTER).outDir;
    const min = build(COUNTER, "--minify");
    expect(min.stdout).toContain("(minified)");
    expect(statSync(join(min.outDir, "app.js")).size).toBeLessThan(
      statSync(join(plain, "app.js")).size * 0.75,
    );
    expect(files(min.outDir)).toEqual(files(plain));
    for (const f of files(plain).filter((f) => f !== "app.js")) {
      expect(readFileSync(join(min.outDir, f), "utf8"), `${f} differs`).toBe(
        readFileSync(join(plain, f), "utf8"),
      );
    }
  });

  it("--bundle writes one app.js, smaller raw and compressed than the modular build", SPAWN, () => {
    const modular = build(COUNTER).outDir;
    const bundled = build(COUNTER, "--bundle");
    expect(bundled.stdout).toContain("bundled");
    expect(files(bundled.outDir)).toEqual(["app.js", "index.html"]);
    const bundledJs = join(bundled.outDir, "app.js");
    expect(readFileSync(bundledJs, "utf8")).not.toContain("./runtime/");

    const modularFiles = [
      join(modular, "app.js"),
      ...readdirSync(join(modular, "runtime")).map((f) => join(modular, "runtime", f)),
    ];
    const raw = (fs: string[]): number => fs.reduce((n, f) => n + statSync(f).size, 0);
    const gz = (fs: string[]): number =>
      fs.reduce((n, f) => n + gzipSync(readFileSync(f), { level: 9 }).length, 0);
    expect(raw([bundledJs])).toBeLessThan(raw(modularFiles) * 0.95);
    expect(gz([bundledJs])).toBeLessThan(gz(modularFiles) * 0.9);
  });

  it("--minify --bundle is --bundle — the flags do not fight", SPAWN, () => {
    const bundled = build(COUNTER, "--bundle").outDir;
    const both = build(COUNTER, "--minify", "--bundle").outDir;
    expect(existsSync(join(both, "runtime"))).toBe(false);
    expect(readFileSync(join(both, "app.js"), "utf8")).toBe(
      readFileSync(join(bundled, "app.js"), "utf8"),
    );
  });

  it.each([["--bundle"], ["--minify"]])(
    "the %s counter still mounts and survives a click",
    SPAWN,
    async (flag) => {
      const root = await mountBuilt(build(COUNTER, flag).outDir);
      expect(root.textContent).toContain("Count: 0");
      clickPlus(root);
      expect(root.textContent).toContain("Count: 1");
      expect((globalThis as { __kumikiApp?: unknown }).__kumikiApp).toBeDefined();
    },
  );
});

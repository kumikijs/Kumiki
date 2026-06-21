// Vite plugin: when @kumikijs/icons is resolvable from the project, the plugin
// runs a second codegen pass that bakes the referenced SVG paths into the
// emitted module's App.icons (#101).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TMP = join(here, "test-tmp");
mkdirSync(TMP, { recursive: true });

const ctx = {
  error(e: unknown): never {
    throw new Error(typeof e === "string" ? e : (e as Error).message);
  },
};

function transformFn() {
  const plugin = kumiki();
  const t = plugin.transform;
  const fn = typeof t === "function" ? t : t?.handler;
  if (!fn) throw new Error("plugin has no transform hook");
  return fn;
}

const FIXTURE = `
slot _ : Text = ""
tile A = icon(name="check")
tile B = icon(name="alert-triangle") {color: "warning"}
tile Root = column(A, B)
app IconApp
    caps   = []
    routes = {"/" -> Root, "/404" -> Root}
    init   = []
`;

describe("vite-plugin-kumiki icon registry", () => {
  it("bakes referenced @kumikijs/icons paths into the emitted App.icons", async () => {
    const dir = mkdtempSync(join(TMP, "icons-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(file, FIXTURE);
    const out = (await transformFn().call(ctx as never, FIXTURE, file)) as { code: string };
    // The plugin resolves @kumikijs/icons from the workspace, so the well-known
    // Heroicons-solid paths for check + alert-triangle land in the output.
    expect(out.code).toContain("App.icons = {");
    expect(out.code).toMatch(/"check":\s*"[mM][^"]+"/);
    expect(out.code).toMatch(/"alert-triangle":\s*"[mM][^"]+"/);
    // Unreferenced names are not baked.
    expect(out.code).not.toContain("x-circle");
    expect(out.code).not.toContain("paperclip");
  });
});

// A batch is a map, so it only remembers the last value written to each slot.
// A `for` loop that walks a bounded slot out of range and back therefore ends
// on a legal value, and the illegal one it passed through — readable by every
// later statement in the body, which is exactly what makes successive writes in
// a loop work — would be invisible to a check that only looked at the batch.
//
// This is the compiled path on purpose: the per-write check lives in codegen
// (`_s.slotWrite` around every assignment to a refined slot), so a hand-written
// AppShape cannot exercise it. It cannot live in the example corpus either —
// `smoke` clicks every button once and treats any console.error as fatal, so an
// example whose whole point is a rejection would fail that tier.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const TMP = join(here, ".smoke-tmp");
mkdirSync(TMP, { recursive: true });

const SOURCE = `
type Small = nominal Int where between(0, 3)

slot count  : Small = 0
slot mirror : Int   = 0

# Ends at 0 — in range — after reaching 4 on the way. \`mirror\` accumulates the
# value \`count\` holds at each step, so a leaked intermediate is permanent.
reducer drift on=ui.click(DriftBtn)
    do= for d in [1, 1, 1, 1, -1, -1, -1, -1] { count  := count + d
                                                mirror := mirror + count }

# Never leaves the range: the guard is that a legal loop still commits.
reducer walk on=ui.click(WalkBtn)
    do= for d in [1, 1, -1, -1] { count  := count + d
                                  mirror := mirror + count }

tile DriftBtn = button(text="drift", onClick=drift)
tile WalkBtn  = button(text="walk", onClick=walk)
tile App = column(DriftBtn, WalkBtn)

app LoopWrites
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

async function loadSource(src: string): Promise<AppShape> {
  const result = compile(src, {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
  });
  if (result.kind !== "ok") {
    throw new Error(result.errors.map((e) => `${e.code} ${e.message}`).join(", "));
  }
  const dir = mkdtempSync(join(TMP, "loop-"));
  const file = join(dir, "app.mjs");
  writeFileSync(
    file,
    result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, ""),
  );
  await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  const app = (globalThis as unknown as { __kumikiApp?: AppShape }).__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return app;
}

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function click(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
}

describe("every write in a reducer body is checked, not just the batch's last", () => {
  it("rejects a loop that leaves the slot's range even though it ends inside it", async () => {
    const app = await loadSource(SOURCE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);

    click(root, "drift");

    // Both slots untouched: 1+2+3+4+3+2+1+0 = 16 was the leak.
    expect(app.live?.count).toBe(0);
    expect(app.live?.mirror).toBe(0);
    expect(errors).toHaveLength(1);
    // Names the value the loop passed through, not the one it ended on — the
    // latter is legal and would explain nothing.
    expect(errors[0]).toContain('slot "count" cannot hold 4 (between(0, 3))');
  });

  it("still commits a loop whose every write stays in range", async () => {
    const app = await loadSource(SOURCE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);

    click(root, "walk");

    expect(app.live?.count).toBe(0);
    expect(app.live?.mirror).toBe(1 + 2 + 1 + 0);
    expect(errors).toEqual([]);
  });
});

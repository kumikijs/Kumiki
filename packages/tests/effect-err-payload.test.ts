// What a `.err` reducer on a built-in storage effect actually receives. The
// scenario for example 119 mocks the err value, so it can only show the shape
// the scenario author believed in; this runs the same program against the real
// `storage.read` handler with localStorage failing, so the example's
// `problem := $e.message` is checked against what the runtime delivers.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "119-effect-payload-bind-types.kumiki");

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitUntil(done: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await tick();
  }
}

describe("a failed storage.read delivers the runtime's failure record to .err", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("example 119 renders the failure's message, not the record", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const app = await loadApp(EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    let dispose: (() => void) | undefined;
    try {
      ({ dispose } = mount(app, root));
      await waitUntil(() => /problem: \S/.test(root.textContent ?? ""));
      expect(root.textContent).toContain("problem: Error: storage blocked");
      expect(root.textContent).not.toContain("[object Object]");
    } finally {
      dispose?.();
      root.remove();
    }
  });
});

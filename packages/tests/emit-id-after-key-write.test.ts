// `lastId := emit load(x)` yields the id `emit cancel(id)` is later given, and
// the dispatcher registers the in-flight request under an id of its own. Both
// are `"<effect>:" + key`, with the key from `policy=latest-per-key(...)`, so
// they agree only if the key is computed from the same slot values in both
// places. The dispatcher runs after the reducer's writes are applied; the
// id is built inside the reducer body. A reducer that moves the key slot and
// then emits is where the two can part — and when they do, the cancel names
// nothing in flight and aborts nothing, silently.
//
// What is pinned here is the whole round trip through a real `fetch` double:
// the request is left pending, the id the reducer kept is handed back, and the
// request that id names is the one that is aborted.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText, type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "116-emit-id-after-key-write.kumiki");

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A response that never arrives, and fails the way `fetch` does when its signal is aborted. */
function pendingUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError")),
    );
  });
}

describe("the EffectId an emit yields after its reducer wrote the key slot", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("cancels the request the dispatcher registered", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch((call) => pendingUntilAborted(call.init.signal));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Open b");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual(["/api/notes/b"]);
      expect(double.calls[0]?.init.signal?.aborted).toBe(false);

      clickByText(root, "Cancel");
      await tick();
      expect(double.calls[0]?.init.signal?.aborted).toBe(true);
      expect(root.textContent).toContain("cancelled");

      dispose();
    } finally {
      root.remove();
    }
  });
});

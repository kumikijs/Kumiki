// What a `.err` reducer on a built-in storage-family effect actually receives.
// A scenario or test mock can deliver any shape it likes, so it only shows the
// shape its author believed in; these run programs against the real
// `storage.*` / `session.*` / `indexed.*` handlers, failing, and check that the
// reducer's `problem := $e` gets the `Text` the effect's `out=Result(_, Text)`
// declares (http.md §6.7) — not a record, which renders as "[object Object]".

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, type CapabilityProvider, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

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

/** Mount `app`, wait for its `problem: …` line to fill, and return the page text. */
async function problemShown(
  app: AppShape,
  providers?: Record<string, CapabilityProvider>,
): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let dispose: (() => void) | undefined;
  try {
    ({ dispose } = mount(app, root, providers ? { providers } : undefined));
    await waitUntil(() => /problem: \S/.test(root.textContent ?? ""));
    return root.textContent ?? "";
  } finally {
    dispose?.();
    root.remove();
  }
}

/** A program whose one effect fails at boot and whose `.err` stores `$e` as it is. */
const failingAtBoot = (cap: string, mapRequest: string, extra = ""): string => `
slot problem : Text = ""
effect run cap=${cap} in=Unit out=Result(Unit, Text)
    map-request=${mapRequest}
reducer boot   on=app.start      do= emit run()
reducer failed on=run.err($e, _) do= problem := $e
tile App = column(text("problem: " + problem))
app ErrPayload
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []
${extra}`;

describe("a failed storage-family effect delivers its declared Text to .err", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("storage.read: example 119 renders the failure's message", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const text = await problemShown(await loadApp(EXAMPLE));
    expect(text).toContain("problem: Error: storage blocked");
    expect(text).not.toContain("[object Object]");
  });

  it("session.write: a throwing sessionStorage renders the failure's message", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const app = await loadSource(failingAtBoot("session.write", `{key: "k", value: "v"}`));
    const text = await problemShown(app);
    expect(text).toContain("problem: Error: quota exceeded");
    expect(text).not.toContain("[object Object]");
  });

  it("indexed.read: an app with no app.indexed-db renders why", async () => {
    const app = await loadSource(failingAtBoot("indexed.read", `{store: "notes", key: "k"}`));
    const text = await problemShown(app);
    expect(text).toContain("problem: app.indexed-db is not declared");
    expect(text).not.toContain("[object Object]");
  });

  it("a host provider for storage.write that throws is delivered as the same Text", async () => {
    // Not the handler's own catch: the throw escapes the provider, which the
    // dispatcher would otherwise wrap as `{message: …}` without knowing `E`.
    const app = await loadSource(failingAtBoot("storage.write", `{key: "k", value: "v"}`));
    const text = await problemShown(app, {
      "storage.write": () => {
        throw new Error("provider down");
      },
    });
    expect(text).toContain("problem: Error: provider down");
    expect(text).not.toContain("[object Object]");
  });
});

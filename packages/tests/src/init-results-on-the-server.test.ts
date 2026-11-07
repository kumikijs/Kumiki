import { feature } from "@kumikijs/examples";
import { type AppShape, type CapabilityProvider, hydrate, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot, texts, waitUntil, withMounted } from "./helpers/dom.ts";
import { loadFactory } from "./helpers/load.ts";

/** `/quote` answers 503 on its first call and `hello` after it; any other URL answers `ok`. */
const flakyQuote = (): CapabilityProvider => {
  let quoteCalls = 0;
  return async (request) => {
    const { url } = request as { url: string };
    if (url !== "/quote") return { kind: "ok", value: "ok" };
    if (quoteCalls++ === 0) {
      return {
        kind: "err",
        value: { status: 503, message: "Service Unavailable", body: { _tag: "None" } },
      };
    }
    return { kind: "ok", value: "hello" };
  };
};

const transportDown: CapabilityProvider = async () => {
  throw new Error("transport down");
};

const stored: CapabilityProvider = async () => ({
  kind: "ok",
  value: { _tag: "Some", _0: "stored" },
});

type Case = {
  example: string;
  /** Called once per pass, as a server and a browser each have providers of their own. */
  providers: () => Record<string, CapabilityProvider>;
  shown: string[];
};

const cases: Case[] = [
  {
    example: "281-init-results-on-the-server",
    providers: () => ({ "http.get": flakyQuote(), "http.post": transportDown }),
    shown: ["themeAt=dark", "quote=hello", "pinged=err [Error: transport down]"],
  },
  {
    example: "64-init-slot-argument",
    providers: () => ({ "storage.read": stored }),
    shown: ["note=stored", "scope=kumiki:note", "themeAt=kumiki:theme"],
  },
];

type Delivery = { reducer: string; payload: Record<string, unknown> };

/** Record the payload each `.ok` / `.err` reducer of `app` is handed, ordered by reducer. */
function recordDeliveries(app: AppShape): () => Delivery[] {
  const seen: Delivery[] = [];
  for (const r of app.reducers) {
    if (r.event.kind !== "effect") continue;
    const apply = r.apply;
    r.apply = (slots, payload) => {
      seen.push({ reducer: r.name, payload });
      return apply(slots, payload);
    };
  }
  return () => [...seen].sort((a, b) => a.reducer.localeCompare(b.reducer));
}

type Pass = { shown: string[]; slots: Record<string, unknown>; delivered: Delivery[] };

/** Boot the example in the browser and let every init result land. */
async function mounted(c: Case): Promise<Pass> {
  const app = (await loadFactory(feature(c.example)))();
  const delivered = recordDeliveries(app);
  return withMounted(
    app,
    async (root) => {
      // A page that never settles on `shown` is left for the assertion to report.
      await waitUntil(() => texts(root).join("\n") === c.shown.join("\n")).catch(() => undefined);
      const slots = Object.fromEntries(Object.keys(app.slots).map((k) => [k, app.live?.[k]]));
      return { shown: texts(root), slots, delivered: delivered() };
    },
    { providers: c.providers() },
  );
}

/** Serve the example, carry the result through JSON as a page does, and hydrate a fresh app. */
async function servedAndHydrated(c: Case): Promise<{ served: Pass; hydrated: string[] }> {
  const createApp = await loadFactory(feature(c.example));
  const server = createApp();
  const delivered = recordDeliveries(server);
  const rendered = await renderToString(server, { providers: c.providers() });
  const wire: typeof rendered = JSON.parse(JSON.stringify(rendered));
  const page = document.createElement("div");
  page.innerHTML = wire.html;
  const served = { shown: texts(page), slots: wire.snapshot.slots, delivered: delivered() };
  const target = freshRoot();
  target.innerHTML = wire.html;
  const handle = hydrate(createApp(), target, wire, { providers: c.providers() });
  try {
    return { served, hydrated: texts(target) };
  } finally {
    handle.dispose();
    target.remove();
  }
}

describe("an app.init result on the server pass", () => {
  it.each(cases)("$example: serves, snapshots and hydrates what a mount shows", async (c) => {
    const live = await mounted(c);
    const { served, hydrated } = await servedAndHydrated(c);
    expect(live.shown).toEqual(c.shown);
    expect(served.shown).toEqual(live.shown);
    expect(served.slots).toEqual(live.slots);
    expect(hydrated).toEqual(live.shown);
  });

  it.each(cases)("$example: hands each result reducer the binds a mount hands it", async (c) => {
    const live = await mounted(c);
    const { served } = await servedAndHydrated(c);
    expect(served.delivered).toEqual(live.delivered);
  });
});

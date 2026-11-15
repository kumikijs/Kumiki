import { feature } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, mountApp, tick } from "./helpers/dom.ts";
import {
  type FetchDouble,
  type Held,
  heldAt,
  holdEach,
  readHeader,
  stubFetch,
} from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("81-http-config-from-slots");
const DURATION_EXAMPLE = feature("120-http-config-value-types");

describe("app.http fields that read a slot", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("reaches fetch with each slot's value, and follows the slots between requests", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(() => new Response("a quote"));
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Load quote");
      await tick(30);
      expect(double.calls.map((c) => c.url)).toEqual(["https://api.example.com/quote"]);
      expect(double.calls[0]?.init.credentials).toBe("include");
      expect(readHeader(double.calls[0]?.init.headers, "X-Endpoint")).toBe(
        "https://api.example.com",
      );
      expect(readHeader(double.calls[0]?.init.headers, "X-Mode")).toBe("loose");

      // Writes only the slots the fields read: a field read once would repeat the first request.
      clickContaining(root, "Use backup");
      clickContaining(root, "Tighten");
      clickContaining(root, "Load quote");
      await tick(30);
      expect(double.calls.map((c) => c.url)).toEqual([
        "https://api.example.com/quote",
        "https://backup.example.com/quote",
      ]);
      expect(double.calls[1]?.init.credentials).toBe("omit");
      expect(readHeader(double.calls[1]?.init.headers, "X-Endpoint")).toBe(
        "https://backup.example.com",
      );
      expect(readHeader(double.calls[1]?.init.headers, "X-Mode")).toBe("tight");

      handle.dispose();
    } finally {
      root.remove();
    }
  });

  it("arms the abort with the timeout slot's current value", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(holdEach());
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Tighten");
      clickContaining(root, "Load quote");
      await tick(300);

      expect((app.live as Record<string, unknown>).status).toBe("error");
      handle.dispose();
    } finally {
      root.remove();
    }
  });

  it("reads a Duration timeout as milliseconds, so a slow answer still arrives", async () => {
    const app = await loadApp(DURATION_EXAMPLE);
    const held: Held[] = [];
    double = stubFetch(holdEach(held));
    const { root, handle } = mountApp(app);
    try {
      clickContaining(root, "Load quote");
      await tick(100);
      heldAt(held, 0).answer("Simplicity is a great virtue.");
      await tick(200);

      expect(double.calls.map((c) => c.url)).toEqual(["https://api.example.com/quote"]);
      expect((app.live as Record<string, unknown>).quote).toBe("Simplicity is a great virtue.");
      handle.dispose();
    } finally {
      root.remove();
    }
  });
});

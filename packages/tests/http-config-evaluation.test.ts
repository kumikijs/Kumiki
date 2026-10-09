import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText, type FetchDouble, readHeader, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "81-http-config-from-slots.kumiki");
const DURATION_EXAMPLE = join(
  here,
  "..",
  "examples",
  "features",
  "120-http-config-value-types.kumiki",
);

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("app.http fields that read a slot", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("reaches fetch with each slot's value, and follows the slots between requests", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(() => new Response("a quote"));
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Load quote");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual(["https://api.example.com/quote"]);
      expect(double.calls[0]?.init.credentials).toBe("include");
      expect(readHeader(double.calls[0]?.init.headers, "X-Endpoint")).toBe(
        "https://api.example.com",
      );
      expect(readHeader(double.calls[0]?.init.headers, "X-Mode")).toBe("loose");

      // Two reducers, writing the four slots the fields read and nothing else. If a
      // field were read once, this request would repeat the first one.
      clickByText(root, "Use backup");
      clickByText(root, "Tighten");
      clickByText(root, "Load quote");
      await tick();
      expect(double.calls.map((c) => c.url)).toEqual([
        "https://api.example.com/quote",
        "https://backup.example.com/quote",
      ]);
      expect(double.calls[1]?.init.credentials).toBe("omit");
      expect(readHeader(double.calls[1]?.init.headers, "X-Endpoint")).toBe(
        "https://backup.example.com",
      );
      expect(readHeader(double.calls[1]?.init.headers, "X-Mode")).toBe("tight");

      dispose();
    } finally {
      root.remove();
    }
  });

  it("arms the abort with the timeout slot's current value", async () => {
    const app = await loadApp(EXAMPLE);
    double = stubFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        }),
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Tighten");
      clickByText(root, "Load quote");
      await tick(300);

      expect((app.live as Record<string, unknown>).status).toBe("error");
      dispose();
    } finally {
      root.remove();
    }
  });

  it("reads a Duration timeout as milliseconds, so a slow answer still arrives", async () => {
    const app = await loadApp(DURATION_EXAMPLE);
    double = stubFetch(
      (call) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(new Response("Simplicity is a great virtue.")),
            100,
          );
          call.init.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        }),
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root);

      clickByText(root, "Load quote");
      await tick(300);

      expect(double.calls.map((c) => c.url)).toEqual(["https://api.example.com/quote"]);
      expect((app.live as Record<string, unknown>).quote).toBe("Simplicity is a great virtue.");
      dispose();
    } finally {
      root.remove();
    }
  });
});

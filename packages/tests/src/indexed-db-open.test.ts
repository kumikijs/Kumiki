import { feature } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
import { clickContaining, mountApp, tick, waitUntil } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("185-indexed-db-open-retry");

type Opening = "success" | "blocked" | "error";

const BLOCKED_MS = 50;

const NOTES = new Map<string, unknown>([["a", { id: "a", body: "hi" }]]);

function fire(target: object, handler: unknown, type: string): void {
  if (typeof handler === "function") handler.call(target, new Event(type));
}

function requestOf(result: unknown): object {
  const req: Record<string, unknown> = { result, error: null, onsuccess: null, onerror: null };
  setTimeout(() => fire(req, req.onsuccess, "success"));
  return req;
}

class Connection extends EventTarget {
  closed = false;
  onversionchange: unknown = null;
  onclose: unknown = null;
  readonly objectStoreNames = { contains: (s: string) => s === "notes" };

  close(): void {
    this.closed = true;
  }

  transaction(): object {
    if (this.closed) {
      throw new DOMException("The database connection is closing.", "InvalidStateError");
    }
    return { objectStore: () => ({ get: (key: string) => requestOf(NOTES.get(key)) }) };
  }

  versionChange(): void {
    fire(this, this.onversionchange, "versionchange");
    this.dispatchEvent(new Event("versionchange"));
  }

  lose(): void {
    this.closed = true;
    fire(this, this.onclose, "close");
    this.dispatchEvent(new Event("close"));
  }
}

type Double = { opens: number; connections: Connection[] };

// Each `open()` answers with the next entry of `script`, the last one repeating; every open asks
// for an upgrade, as the example's version 2 does against a version-1 database.
function installIndexedDb(script: Opening[]): Double {
  const double: Double = { opens: 0, connections: [] };
  const factory = {
    open(): object {
      const how = script[Math.min(double.opens, script.length - 1)];
      double.opens++;
      const req: Record<string, unknown> = {
        result: undefined,
        error: null,
        transaction: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
      };
      const succeed = (): void => {
        const db = new Connection();
        double.connections.push(db);
        req.result = db;
        req.transaction = {
          objectStore: () => ({ indexNames: { contains: () => false }, createIndex: () => {} }),
        };
        fire(req, req.onupgradeneeded, "upgradeneeded");
        req.transaction = null;
        fire(req, req.onsuccess, "success");
      };
      setTimeout(() => {
        if (how === "error") {
          req.error = new DOMException("the open failed", "UnknownError");
          fire(req, req.onerror, "error");
        } else if (how === "blocked") {
          fire(req, req.onblocked, "blocked");
          setTimeout(succeed, BLOCKED_MS);
        } else {
          succeed();
        }
      });
      return req;
    },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = factory;
  return double;
}

function status(root: HTMLElement): string {
  return /status: (.*)$/.exec(root.textContent ?? "")?.[1] ?? "";
}

async function load(root: HTMLElement): Promise<string> {
  clickContaining(root, "Load");
  expect(status(root)).toBe("loading");
  await waitUntil(() => status(root) !== "loading");
  return status(root);
}

async function withExample(body: (root: HTMLElement) => Promise<void>): Promise<void> {
  const { root, handle } = mountApp(await loadApp(EXAMPLE));
  try {
    await body(root);
  } finally {
    handle.dispose();
    root.remove();
  }
}

describe("an indexed-* effect opens app.indexed-db as part of its own call", () => {
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;
  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = original;
  });

  it("an open that reports blocked waits for its success, and the next load reuses it", async () => {
    const idb = installIndexedDb(["blocked"]);
    await withExample(async (root) => {
      expect(await load(root)).toBe("loaded hi");
      await tick(200);
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(1);
  });

  it("an open that fails is that load's err, and the next load opens again", async () => {
    const idb = installIndexedDb(["error", "success"]);
    await withExample(async (root) => {
      expect(await load(root)).toBe("err: UnknownError: the open failed");
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(2);
  });

  it("versionchange closes the page's connection, and the next load opens again", async () => {
    const idb = installIndexedDb(["success"]);
    await withExample(async (root) => {
      expect(await load(root)).toBe("loaded hi");
      const [first] = idb.connections;
      first?.versionChange();
      expect(first?.closed).toBe(true);
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(2);
    expect(idb.connections.map((c) => c.closed)).toEqual([true, false]);
  });

  it("a connection the browser closes is not kept, and the next load opens again", async () => {
    const idb = installIndexedDb(["success"]);
    await withExample(async (root) => {
      expect(await load(root)).toBe("loaded hi");
      idb.connections[0]?.lose();
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(2);
  });
});

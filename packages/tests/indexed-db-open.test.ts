// Opening `app.indexed-db` is part of one `indexed-*` effect's call (http.md
// §6.7.4). Example 185 is mounted with the real `indexed.read` handler against
// a global `indexedDB` double that follows the platform's open lifecycle: a
// blocked upgrade reports `blocked` and later `success` on the same request, a
// failed open reports `error`, another tab opening a newer version sends
// `versionchange` to the connection this page holds, and a connection the
// browser closes on its own reports `close`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { clickByText } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "185-indexed-db-open-retry.kumiki");

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How the double answers one `open()`. */
type Opening = "success" | "blocked" | "error";

/** How long a blocked open waits before the other connection closes. */
const BLOCKED_MS = 50;

/** The records in the double's `notes` store. */
const NOTES = new Map<string, unknown>([["a", { id: "a", body: "hi" }]]);

/** Fire `handler` on `target` as the platform does an event handler attribute. */
function fire(target: object, handler: unknown, type: string): void {
  if (typeof handler === "function") handler.call(target, new Event(type));
}

/** A request that succeeds with `result` on a later task. */
function requestOf(result: unknown): object {
  const req: Record<string, unknown> = { result, error: null, onsuccess: null, onerror: null };
  setTimeout(() => fire(req, req.onsuccess, "success"));
  return req;
}

/** One connection. After `close()` it refuses new transactions, as a real one does. */
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

  /** Another tab opens a newer version while this connection is open. */
  versionChange(): void {
    fire(this, this.onversionchange, "versionchange");
    this.dispatchEvent(new Event("versionchange"));
  }

  /** The browser closes the connection itself, as when site data is cleared. */
  lose(): void {
    this.closed = true;
    fire(this, this.onclose, "close");
    this.dispatchEvent(new Event("close"));
  }
}

type Double = { opens: number; connections: Connection[] };

/**
 * Install a global `indexedDB` whose `open()` calls answer with `script` in
 * order, the last entry repeating. Every open asks for an upgrade, so each
 * `success` follows an `upgradeneeded`.
 */
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

/** The value of the example's `status` slot, as its page shows it. */
function status(root: HTMLElement): string {
  return /status: (.*)$/.exec(root.textContent ?? "")?.[1] ?? "";
}

/** Click Load and return the status the load ends on. */
async function load(root: HTMLElement): Promise<string> {
  clickByText(root, "Load");
  expect(status(root)).toBe("loading");
  const deadline = Date.now() + 2000;
  while (status(root) === "loading") {
    if (Date.now() > deadline) throw new Error("the load did not end within 2000ms");
    await tick();
  }
  return status(root);
}

/** Mount example 185 and hand its root to `body`. */
async function withApp(body: (root: HTMLElement) => Promise<void>): Promise<void> {
  const app = await loadApp(EXAMPLE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const { dispose } = mount(app, root);
  try {
    await body(root);
  } finally {
    dispose();
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
    await withApp(async (root) => {
      expect(await load(root)).toBe("loaded hi");
      await tick(200);
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(1);
  });

  it("an open that fails is that load's err, and the next load opens again", async () => {
    const idb = installIndexedDb(["error", "success"]);
    await withApp(async (root) => {
      expect(await load(root)).toBe("err: UnknownError: the open failed");
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(2);
  });

  it("versionchange closes the page's connection, and the next load opens again", async () => {
    const idb = installIndexedDb(["success"]);
    await withApp(async (root) => {
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
    await withApp(async (root) => {
      expect(await load(root)).toBe("loaded hi");
      idb.connections[0]?.lose();
      expect(await load(root)).toBe("loaded hi");
    });
    expect(idb.opens).toBe(2);
  });
});

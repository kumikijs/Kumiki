import { describe, expect, it } from "vitest";
import {
  createPlaygroundToolHost,
  type ModelContext,
  type PlaygroundApi,
  type WebMcpTool,
} from "./webmcp";

const TOOL_NAMES = [
  "kumiki_compile",
  "kumiki_list_examples",
  "kumiki_load_example",
  "kumiki_set_source",
];

function fakeModelContext(opts: { withUnregister?: boolean } = {}) {
  const registry = new Map<string, WebMcpTool>();
  const mc: ModelContext = {
    registerTool(tool) {
      if (registry.has(tool.name)) {
        // Mirrors Chrome: InvalidStateError "Duplicate tool name"
        throw new Error("Failed to execute 'registerTool' on 'ModelContext': Duplicate tool name");
      }
      registry.set(tool.name, tool);
    },
  };
  if (opts.withUnregister) {
    mc.unregisterTool = (name) => {
      registry.delete(name);
    };
  }
  return { mc, registry };
}

function fakeApi(label: string): PlaygroundApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    compileSource(source: string) {
      calls.push(`compile:${source}`);
      return { ok: true, label };
    },
    listExamples() {
      calls.push("list");
      return [`${label}.kumiki`];
    },
    loadExample(name: string) {
      calls.push(`load:${name}`);
      return name === "known.kumiki";
    },
    setSource(source: string) {
      calls.push(`set:${source}`);
      return "ok";
    },
  };
}

describe("playground WebMCP tool host", () => {
  it("does nothing when modelContext is unavailable", () => {
    const host = createPlaygroundToolHost();
    expect(() => host.bind(undefined, fakeApi("a"))).not.toThrow();
  });

  it("first bind registers exactly the four kumiki_* tools", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext();
    host.bind(mc, fakeApi("a"));
    expect([...registry.keys()].sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("remount does not re-register (no Duplicate tool name)", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext();
    const first = fakeApi("first");
    host.bind(mc, first);
    host.release(first);
    expect(() => host.bind(mc, fakeApi("second"))).not.toThrow();
    expect(registry.size).toBe(TOOL_NAMES.length);
  });

  it("after remount, execute delegates to the new instance", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext();
    const first = fakeApi("first");
    const second = fakeApi("second");
    host.bind(mc, first);
    host.release(first);
    host.bind(mc, second);
    const compileTool = registry.get("kumiki_compile");
    expect(compileTool?.execute({ source: "slot x : Int = 0" })).toEqual({
      ok: true,
      label: "second",
    });
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(["compile:slot x : Int = 0"]);
  });

  it("execute with no mounted instance returns an error result", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext();
    const api = fakeApi("a");
    host.bind(mc, api);
    host.release(api);
    for (const name of TOOL_NAMES) {
      const tool = registry.get(name);
      expect(tool, name).toBeDefined();
      expect(() => tool?.execute({})).not.toThrow();
      expect(tool?.execute({ source: "x", name: "x" })).toMatchObject({ ok: false });
    }
  });

  it("releasing a stale instance keeps the active one bound", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext();
    const first = fakeApi("first");
    const second = fakeApi("second");
    // Mount order can race during SPA page swaps: new page binds before the
    // old page's teardown runs.
    host.bind(mc, first);
    host.bind(mc, second);
    host.release(first);
    const listTool = registry.get("kumiki_list_examples");
    expect(listTool?.execute({})).toEqual(["second.kumiki"]);
  });

  it("with unregisterTool support, release unregisters and rebind re-registers", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext({ withUnregister: true });
    const first = fakeApi("first");
    host.bind(mc, first);
    host.release(first);
    expect(registry.size).toBe(0);
    const second = fakeApi("second");
    host.bind(mc, second);
    expect(registry.size).toBe(TOOL_NAMES.length);
    expect(registry.get("kumiki_list_examples")?.execute({})).toEqual(["second.kumiki"]);
  });

  it("formats load/set results for the agent", () => {
    const host = createPlaygroundToolHost();
    const { mc, registry } = fakeModelContext();
    host.bind(mc, fakeApi("a"));
    const load = registry.get("kumiki_load_example");
    expect(load?.execute({ name: "known.kumiki" })).toBe("loaded known.kumiki");
    expect(load?.execute({ name: "missing.kumiki" })).toBe("not found: missing.kumiki");
    const set = registry.get("kumiki_set_source");
    expect(set?.execute({ source: "src" })).toBe("ok");
  });
});

import type {
  AppShape,
  BindSegment,
  Episode,
  MountedApp,
  TileNode,
  TileRenderers,
} from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstChildMappedColumn } from "./fixtures/host-renderers.ts";
import { appOf, bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { recordingLogger, stripApp } from "./helpers/reconcile-apps.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
});

function lastSignalUpdate(committed: Episode[]) {
  const ep = committed[committed.length - 1];
  return [...(ep?.steps ?? [])].reverse().find((s) => s.kind === "signal-update");
}

function lastBindsUpdated(committed: Episode[]): string[] | undefined {
  const step = lastSignalUpdate(committed);
  return step?.kind === "signal-update" ? step["binds-updated"] : undefined;
}

const panics = (committed: Episode[]) =>
  committed.flatMap((ep) => ep.steps.filter((s) => s.kind === "panic"));

/**
 * A column of `children()`; the `advance` reducer bumps a counter slot so the tree, which
 * reads whatever the test changed in between, is re-rendered as one recorded episode.
 */
function advancingApp(children: () => TileNode[]): MountedApp {
  return bareApp({
    slots: { rev: { value: 0 } },
    reducers: [
      {
        name: "advance",
        event: { kind: "ui", ev: "click" },
        apply: (s) => ({ slots: { rev: (s.rev as number) + 1 }, emits: [] }),
      },
    ],
    root: (): TileNode => ({ kind: "column", children: children() }),
  }) as MountedApp;
}

function mountRecorded(app: AppShape, tiles?: TileRenderers) {
  const { logger, committed } = recordingLogger();
  const { dispose } = mount(app, root, { episodeLogger: logger, ...(tiles ? { tiles } : {}) });
  return { committed, dispose };
}

describe("an episode's binds-updated names the tiles a render rebuilt or patched", () => {
  it("names only the tile the diff touched", () => {
    const app = stripApp(5) as MountedApp;
    const { committed, dispose } = mountRecorded(app);

    app._dispatch("bump", {});

    expect(lastBindsUpdated(committed)).toEqual(["heading"]);
    dispose();
  });

  it.each<[string, BindSegment[] | undefined, string]>([
    ["joins the bind and its path", ["title"], "todo.title"],
    ["collapses an empty path to the bind", [], "todo"],
    ["uses the bind when there is no path", undefined, "todo"],
  ])("%s for a patched form control", (_label, bindPath, expected) => {
    let value = "initial";
    const app = advancingApp(() => [
      { kind: "input", bind: "todo", ...(bindPath ? { bindPath } : {}), value },
    ]);
    const { committed, dispose } = mountRecorded(app);

    value = "changed";
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual([expected]);
    dispose();
  });

  it("names the key of a keyed insert and not the survivors", () => {
    let ids = ["a", "b"];
    const app = advancingApp(() =>
      ids.map((id): TileNode => ({ kind: "text", text: id, key: id })),
    );
    const { committed, dispose } = mountRecorded(app);

    ids = ["a", "b", "c"];
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["c"]);
    dispose();
  });

  it("is empty when the dirty slot did not change the tile tree", () => {
    const app = advancingApp(() => [{ kind: "text", text: "static" }]);
    const { committed, dispose } = mountRecorded(app);

    app._dispatch("advance", {});

    expect(lastSignalUpdate(committed)).toMatchObject({
      "dirty-slots": ["rev"],
      "binds-updated": [],
    });
    dispose();
  });

  it("names the incoming tile when the kind at a position changes", () => {
    let showHeading = true;
    const app = advancingApp(() => [
      { kind: "text", text: "top" },
      showHeading ? { kind: "heading", text: "swap" } : { kind: "text", text: "swap" },
      { kind: "text", text: "bottom" },
    ]);
    const { committed, dispose } = mountRecorded(app);

    showHeading = false;
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["text"]);
    dispose();
  });

  it("lists an identifier shared by several rebuilt tiles once", () => {
    let n = 0;
    const app = advancingApp(() => [
      { kind: "text", text: `top ${n}` },
      { kind: "text", text: "static" },
      { kind: "text", text: `bottom ${n}` },
    ]);
    const { committed, dispose } = mountRecorded(app);

    n = 1;
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["text"]);
    dispose();
  });

  it.each<[string, string[], string[], string[]]>([
    ["names each child when a list grows from empty", [], ["a", "b", "c"], ["a", "b", "c"]],
    ["names the parent when a list is cleared to empty", ["a", "b"], [], ["column"]],
  ])("%s", (_label, before, after, expected) => {
    let ids = before;
    const app = advancingApp(() =>
      ids.map((id): TileNode => ({ kind: "text", text: id, key: id })),
    );
    const { committed, dispose } = mountRecorded(app);

    ids = after;
    app._dispatch("advance", {});

    expect(root.firstElementChild?.children.length).toBe(after.length);
    expect(lastBindsUpdated(committed)).toEqual(expected);
    dispose();
  });
});

describe("binds-updated when the walk bails", () => {
  it("is empty, and a panic is recorded, when reconcile throws and the tree is rebuilt", () => {
    captureConsole();
    let broken = false;
    const app = advancingApp(() =>
      broken
        ? [
            { kind: "text", text: "a", key: "dup" },
            { kind: "text", text: "b", key: "dup" },
          ]
        : [{ kind: "text", text: "start", key: "s" }],
    );
    const { committed, dispose } = mountRecorded(app);

    broken = true;
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual([]);
    expect(panics(committed.slice(-1))).not.toEqual([]);
    dispose();
  });

  it("names only the rebuilt parent when a hole abandons the positional walk", () => {
    let holed = false;
    const app = advancingApp(() =>
      holed
        ? ([{ kind: "text", text: "a2", key: "a" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a", key: "a" },
            { kind: "text", text: "b", key: "b" },
          ],
    );
    const { committed, dispose } = mountRecorded(app);

    holed = true;
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["column"]);
    dispose();
  });

  it("names only the rebuilt parent when an unmapped child abandons the walk", () => {
    let label = "a";
    const app = advancingApp(() => [
      { kind: "text", text: label },
      { kind: "text", text: "hand-built" },
    ]);
    const { committed, dispose } = mountRecorded(app, {
      column: firstChildMappedColumn,
    } as TileRenderers);

    label = "a2";
    app._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["column"]);
    dispose();
  });

  it("leaves the element map describing only what is mounted after a bail", () => {
    let holed = false;
    const app = advancingApp(() =>
      holed
        ? ([{ kind: "text", text: "a2" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a" },
            { kind: "text", text: "b" },
          ],
    );
    const { committed, dispose } = mountRecorded(app);

    holed = true;
    app._dispatch("advance", {});
    holed = false;
    app._dispatch("advance", {});

    expect(panics(committed)).toEqual([]);
    expect(
      Array.from(root.querySelectorAll('[data-kumiki-tile="text"]')).map((el) => el.textContent),
    ).toEqual(["a", "b"]);
    dispose();
  });

  it("records no panic when a list's `ordered` flip declines the in-place patch", () => {
    let ordered = false;
    const app = appOf(() => ({
      kind: "list",
      ordered,
      children: [{ kind: "list-item", children: [{ kind: "text", text: "one" }] }],
    }));
    const { committed, dispose } = mountRecorded(app);
    expect(root.firstElementChild?.tagName).toBe("UL");

    ordered = true;
    app._rerender?.();

    expect(root.firstElementChild?.tagName).toBe("OL");
    expect(panics(committed)).toEqual([]);
    dispose();
  });
});

import type { AppShape } from "@kumikijs/runtime";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { click, withMounted } from "./helpers/dom.ts";
import { loadFactory, writeSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const DEFINITIONS = 40;
const WHERES = 250;

/** Refuses -1, which every other predicate accepts. */
const FIRST = "between(0, 1000)";
/** Refuses 51. */
const MIDDLE = "between(-1000, 50)";
/** Refuses 8, and accepts 7 and 9. */
const LAST = "one-of(-1, 7, 9, 51)";
/** Every other predicate, which no value written here fails. */
const FILLER = "between(-1000, 1000)";

function chain(): string {
  const lines: string[] = [];
  for (let i = 0; i < DEFINITIONS; i += 1) {
    const preds = Array.from({ length: WHERES }, (_, w) => {
      if (i === 0 && w === 0) return FIRST;
      if (i === DEFINITIONS / 2 && w === 0) return MIDDLE;
      if (i === DEFINITIONS - 1 && w === WHERES - 1) return LAST;
      return FILLER;
    });
    lines.push(
      `type T${i} = ${i === 0 ? "Int" : `T${i - 1}`}${preds.map((p) => ` where ${p}`).join("")}`,
    );
  }
  return lines.join("\n");
}

const SOURCE = withApp(`${chain()}

slot x : T${DEFINITIONS - 1} = 7

reducer writeFirst  on=ui.click(FirstBtn)  do= x := -1
reducer writeMiddle on=ui.click(MiddleBtn) do= x := 51
reducer writeLast   on=ui.click(LastBtn)   do= x := 8
reducer writeEvery  on=ui.click(EveryBtn)  do= x := 2000
reducer writeOk     on=ui.click(OkBtn)     do= x := 9

tile FirstBtn  = button(text="first", onClick=writeFirst)
tile MiddleBtn = button(text="middle", onClick=writeMiddle)
tile LastBtn   = button(text="last", onClick=writeLast)
tile EveryBtn  = button(text="every", onClick=writeEvery)
tile OkBtn     = button(text="ok", onClick=writeOk)
tile App = column(FirstBtn, MiddleBtn, LastBtn, EveryBtn, OkBtn)`);

let createApp: () => AppShape;
let errors: string[];

beforeAll(async () => {
  createApp = await loadFactory(writeSource("refinement-chain", SOURCE));
}, 60_000);

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a slot typed by the top of a chain of forty definitions of 250 `where`s", () => {
  it.each([
    ["the first definition's predicate", "first", -1, FIRST],
    ["the middle definition's predicate", "middle", 51, MIDDLE],
    ["the last definition's predicate", "last", 8, LAST],
    // It is named by the first it fails from the base outward.
    ["every predicate", "every", 2000, FIRST],
  ])("refuses a write failing %s, and names the first it fails", async (_, button, value, predicate) => {
    const app = createApp();
    await withMounted(app, async (root) => {
      click(root, button);

      expect(app.live?.x).toBe(7);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`slot "x" cannot hold ${value} (${predicate})`);
    });
  });

  it("commits a write every predicate accepts", async () => {
    const app = createApp();
    await withMounted(app, async (root) => {
      click(root, "ok");

      expect(app.live?.x).toBe(9);
      expect(errors).toEqual([]);
    });
  });
});

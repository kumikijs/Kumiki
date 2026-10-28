import type { AppShape } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
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
reducer writeOk     on=ui.click(OkBtn)     do= x := 9

tile FirstBtn  = button(text="first", onClick=writeFirst)
tile MiddleBtn = button(text="middle", onClick=writeMiddle)
tile LastBtn   = button(text="last", onClick=writeLast)
tile OkBtn     = button(text="ok", onClick=writeOk)
tile App = column(FirstBtn, MiddleBtn, LastBtn, OkBtn)`);

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mounted(): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadSource(SOURCE);
  return { app, root: mountApp(app).root };
}

describe("a slot typed by the top of a chain of forty definitions of 250 `where`s", () => {
  it.each([
    ["first", -1, FIRST],
    ["middle", 51, MIDDLE],
    ["last", 8, LAST],
  ])(
    "refuses a write failing the %s definition's predicate, and names it",
    async (button, value, predicate) => {
      const { app, root } = await mounted();

      click(root, button);

      expect(app.live?.x).toBe(7);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`slot "x" cannot hold ${value} (${predicate})`);
    },
    30_000,
  );

  it("commits a write every predicate accepts", async () => {
    const { app, root } = await mounted();

    click(root, "ok");

    expect(app.live?.x).toBe(9);
    expect(errors).toEqual([]);
  }, 30_000);
});

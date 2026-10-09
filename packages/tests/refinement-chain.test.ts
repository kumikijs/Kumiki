// A type's predicates accumulate over every name it is declared through
// (language.md §1.3.1), and nothing bounds how many names that is: the depth
// budget (§1.2.3) counts the `where`s on one type expression, not the
// definitions a chain passes through. A slot typed by the top of a long chain
// is gated by every predicate on it once the app is built and mounted — a
// write failing the first of them, one in the middle or the last is refused
// and reported against that predicate, and a write passing all of them lands.

import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSource } from "./helpers/load.ts";

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

/**
 * `T0` … `T39`, each over the one before and adding 250 `where`s of its own:
 * FIRST opens `T0`, MIDDLE opens `T20`, LAST closes `T39`.
 */
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

const SOURCE = `${chain()}

slot x : T${DEFINITIONS - 1} = 7

reducer writeFirst  on=ui.click(FirstBtn)  do= x := -1
reducer writeMiddle on=ui.click(MiddleBtn) do= x := 51
reducer writeLast   on=ui.click(LastBtn)   do= x := 8
reducer writeOk     on=ui.click(OkBtn)     do= x := 9

tile FirstBtn  = button(text="first", onClick=writeFirst)
tile MiddleBtn = button(text="middle", onClick=writeMiddle)
tile LastBtn   = button(text="last", onClick=writeLast)
tile OkBtn     = button(text="ok", onClick=writeOk)
tile App = column(FirstBtn, MiddleBtn, LastBtn, OkBtn)

app RefinementChain
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

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

async function mounted(): Promise<{
  app: Awaited<ReturnType<typeof loadSource>>;
  root: HTMLElement;
}> {
  const app = await loadSource(SOURCE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return { app, root };
}

function click(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
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

import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

async function mounted(defs: string): Promise<{ root: HTMLElement; live: () => unknown }> {
  const app = await loadSource(withApp(defs));
  const { root, handle } = mountApp(app);
  disposals.push(() => {
    handle.dispose();
    root.remove();
  });
  return { root, live: () => app.live };
}

/** The text of every `text` tile, in document order. */
function lines(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("[data-kumiki-tile='text']")).map(
    (e) => e.textContent ?? "",
  );
}

const PRIMITIVES = ["Int", "Text", "Bool", "Unit", "Float", "Time", "Bytes", "File", "EffectId"];

/** A union holding `p` beside `Other`, with `p` in every position a nullary variant has. */
const program = (union: string, p: string): string => `
type V = ${union}
slot v : V = ${p}
fn back(x: V) -> V = match x with | ${p} -> Other | Other -> ${p}
reducer toOther on=ui.click(ToOther) do= v := Other
reducer toBack on=ui.click(ToBack) do= v := back(v)
tile ToOther = button(text="other")
tile ToBack = button(text="back")
tile App = column(
  ToOther,
  ToBack,
  text(match v with | ${p} -> "match ${p}" | Other -> "match Other"),
  text("eq " + (v == ${p}).show),
  text("show " + v.show),
  text(if v == ${p} then "if ${p}" else "if Other"),
  when(v == ${p}, text("when ${p}")))`;

describe("a nullary variant named after a primitive type", () => {
  it.each(
    PRIMITIVES.flatMap((p) => [
      [p, "first", `${p} | Other`],
      [p, "after another", `Other | ${p}`],
    ]),
  )("%s, %s, is a value, a pattern and an operand", async (p, _where, union) => {
    const { root, live } = await mounted(program(union, p));
    const atP = [`match ${p}`, "eq true", `show ${p}`, `if ${p}`, `when ${p}`];
    expect(lines(root)).toEqual(atP);
    expect(live()).toMatchObject({ v: { _tag: p } });

    click(root, "other");
    expect(lines(root)).toEqual(["match Other", "eq false", "show Other", "if Other"]);
    expect(live()).toMatchObject({ v: { _tag: "Other" } });

    click(root, "back");
    expect(lines(root)).toEqual(atP);
    expect(live()).toMatchObject({ v: { _tag: p } });
  });

  it("is told apart from its siblings in a union of several", async () => {
    const { root } = await mounted(`
type SortBy = Name | Time | Size
slot sort : SortBy = Name
reducer byTime on=ui.click(ByTime) do= sort := Time
reducer bySize on=ui.click(BySize) do= sort := Size
tile ByTime = button(text="time")
tile BySize = button(text="size")
tile App = column(ByTime, BySize,
  text(match sort with | Name -> "by name" | Time -> "by time" | Size -> "by size"))`);
    expect(lines(root)).toEqual(["by name"]);
    click(root, "time");
    expect(lines(root)).toEqual(["by time"]);
    click(root, "size");
    expect(lines(root)).toEqual(["by size"]);
  });
});

describe("the primitive beside a variant of its name", () => {
  const defs = `
type SortBy = Name | Time | Size
type Stamp = Time
type Mark = Unset | Marked(Time)
type Entry = {t: Time, label: Text}
slot sort    : SortBy       = Time
slot started : Stamp        = now
slot mark    : Mark         = Unset
slot entry   : Entry        = {t: now.plus(Duration.h(1)), label: "e"}
slot parsed  : Option(Time) = None
slot names   : List(Text)   = ["a"]
slot counts  : Map(Text, Int) = {"a": 1}
reducer read on=ui.click(Read)
    do= parsed := Time.parse("2026-02-28")
        mark := Marked(started)
        entry := entry.copy(t=started)
tile Read = button(text="read")
tile App = column(Read,
  text(match sort with | Time -> "sort time" | Name -> "sort name" | Size -> "sort size"),
  text(match parsed with | Some(t) -> "parsed " + t.format("yyyy-MM-dd") | None -> "parsed none"),
  text(match mark with | Marked(t) -> "mark " + (t == started).show | Unset -> "mark unset"),
  text("entry " + (entry.t == started).show),
  text("names " + names.length.show + " counts " + counts.size.show))`;

  it("reads every other Time as the primitive and Time.parse as the stdlib call", async () => {
    const { root, live } = await mounted(defs);
    expect(lines(root)).toEqual([
      "sort time",
      "parsed none",
      "mark unset",
      "entry false",
      "names 1 counts 1",
    ]);
    expect(typeof (live() as { started: unknown }).started).toBe("number");

    click(root, "read");
    expect(lines(root)).toEqual([
      "sort time",
      "parsed 2026-02-28",
      "mark true",
      "entry true",
      "names 1 counts 1",
    ]);
  });
});

// `status` is a copy of the `fn` `05-project-management` uses to label a task Overdue.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const DEFS = `type DueStatus = Overdue | DueToday | DueSoon | DueUpcoming
slot early : Time = Time.parse("2026-08-12T10:00Z").get-or(now)
slot late  : Time = Time.parse("2026-08-14T10:00Z").get-or(now)
fn status(t: Time) -> DueStatus
   = let diffMs = t.diff(now).to-ms
     in if diffMs < 0 then Overdue
        else if diffMs < 86400000 then DueToday
        else if diffMs < 259200000 then DueSoon
        else DueUpcoming`;

async function render(shown: string): Promise<string> {
  const app = await loadSource(withApp(`${DEFS}\ntile App = column(text(${shown}))`));
  const report = await withRoot((root) =>
    runScenario(app, root, { steps: [{ expect: { noErrors: true } }] }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  return report.steps.at(-1)?.domText ?? "";
}

describe("Time.diff is the receiver minus the argument", () => {
  it.each([
    ["an earlier receiver is negative", "early.diff(late).to-ms.show", "-172800000"],
    ["a later receiver is positive", "late.diff(early).to-ms.show", "172800000"],
    ["one instant is zero", "early.diff(early).to-ms.show", "0"],
    ["the distance is its abs", "early.diff(late).to-ms.abs.show", "172800000"],
    ["b.plus(a.diff(b)) is a, a earlier", "(late.plus(early.diff(late)) == early).show", "true"],
    ["b.plus(a.diff(b)) is a, a later", "(early.plus(late.diff(early)) == late).show", "true"],
  ])("%s", async (_case, shown, want) => {
    // The brackets keep `0` from matching `-0` or `10`.
    expect(await render(`"[" + ${shown} + "]"`)).toContain(`[${want}]`);
  });
});

describe("a due date read off the sign of diff(now)", () => {
  it.each([
    ["two days ago is Overdue", "now.minus(Duration.d(2))", "Overdue"],
    ["in twelve hours is DueToday", "now.plus(Duration.h(12))", "DueToday"],
    ["in two days is DueSoon", "now.plus(Duration.d(2))", "DueSoon"],
    ["in a month is DueUpcoming", "now.plus(Duration.d(30))", "DueUpcoming"],
  ])("%s", async (_case, due, want) => {
    expect(await render(`"[" + status(${due}).show + "]"`)).toContain(`[${want}]`);
  });
});

// `a.diff(b)` on two `Time`s is `a` minus `b` (stdlib.md §2.2.8): positive
// when the receiver is the later instant, negative when it is the earlier
// one. Its sign is how a program tells which of two instants comes first —
// `05-project-management` labels a task whose `due.diff(now)` is negative
// `Overdue`, and `status` below is a copy of that `fn`.
//
// Each row renders one value of the compiled program in happy-dom and reads it
// off the page.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const DEFS = `type DueStatus = Overdue | DueToday | DueSoon | DueUpcoming
slot early : Time = Time.parse("2026-08-12T10:00Z").get-or(now)
slot late  : Time = Time.parse("2026-08-14T10:00Z").get-or(now)
fn status(t: Time) -> DueStatus
   = let diffMs = t.diff(now).to-ms
     in if diffMs < 0 then Overdue
        else if diffMs < 86400000 then DueToday
        else if diffMs < 259200000 then DueSoon
        else DueUpcoming`;

/** Render `shown` and return the page text. */
async function render(shown: string): Promise<string> {
  const src = `${DEFS}
tile App = column(text(${shown}))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const report = await runScenario(await loadSource(src), root, {
      steps: [{ expect: { noErrors: true } }],
    });
    expect(report.ok).toBe(true);
    return report.steps.at(-1)?.domText ?? "";
  } finally {
    root.remove();
  }
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
    // The `[` `]` around the value keep `0` from matching `-0` or `10`.
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

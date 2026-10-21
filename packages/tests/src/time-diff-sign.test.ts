// `status` is the `Some` arm of `dueDateStatus` in 05-project-management, under another name.

import { runScenario } from "@kumikijs/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const DEFS = `type DueStatus = Overdue | DueToday | DueSoon | DueUpcoming
fn status(t: Time) -> DueStatus
   = let diffMs = t.diff(now).to-ms
     in if diffMs < 0 then Overdue
        else if diffMs < 86400000 then DueToday
        else if diffMs < 259200000 then DueSoon
        else DueUpcoming`;

const DUE = [
  { name: "two days ago is Overdue", due: "now.minus(Duration.d(2))", want: "Overdue" },
  { name: "in twelve hours is DueToday", due: "now.plus(Duration.h(12))", want: "DueToday" },
  { name: "in two days is DueSoon", due: "now.plus(Duration.d(2))", want: "DueSoon" },
  { name: "in a month is DueUpcoming", due: "now.plus(Duration.d(30))", want: "DueUpcoming" },
];

let page: string;

// One page renders every row as `[<index>: <status>]`.
beforeAll(async () => {
  const texts = DUE.map(({ due }, i) => `text("[${i}: " + status(${due}).show + "]")`);
  const app = await loadSource(withApp(`${DEFS}\ntile App = column(${texts.join(", ")})`));
  const report = await withRoot((root) =>
    runScenario(app, root, { steps: [{ expect: { noErrors: true } }] }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  page = report.steps.at(-1)?.domText ?? "";
}, 30_000);

describe("a due date read off the sign of diff(now)", () => {
  it.each(DUE)("$name", (row) => {
    expect(page).toContain(`[${DUE.indexOf(row)}: ${row.want}]`);
  });
});

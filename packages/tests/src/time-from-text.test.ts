import { feature } from "@kumikijs/examples";
import { _stdlib, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { freshRoot, texts, waitUntil, withMounted } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

const PATTERN = "yyyy-MM-dd HH:mm";
// What `format(PATTERN)` renders for a value that names no instant (stdlib.md §2.2.8).
const NO_INSTANT = "0NaN-NaN-NaN NaN:NaN";

describe("format reads a Time held as text by Time.parse's grammar", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("renders each decoded text as Time.parse reads it, so digits are no instant", async () => {
    const inputs = [
      "1",
      "2026",
      "20260307",
      "1772877600000",
      "hello 12",
      "March 7",
      "Tue 5",
      "2026-03-07",
      "2026-03-07T10:00",
      "2026-03-07 10:00:00.5",
      "2026-03-07T10:00:00Z",
      "2026-03-07T19:00:00+09:00",
    ];
    const rows = inputs.map((at, i) => ({ label: `row${i}`, at }));
    double = stubFetch(() => new Response(JSON.stringify(rows)));
    const app = await loadApp(feature("198-time-from-text"));
    await withMounted(app, async (root) => {
      await waitUntil(() => texts(root).some((l) => l.startsWith(`row${inputs.length - 1}: `)), {
        timeoutMs: 3000,
      });
      inputs.forEach((text, i) => {
        const parsed = _stdlib.parseTime(text);
        const expected =
          parsed._tag === "Some" ? _stdlib.formatTime(parsed._0, PATTERN) : NO_INSTANT;
        expect(texts(root), text).toContain(`row${i}: ${expected}`);
      });
      expect(texts(root)).toContain(`row0: ${NO_INSTANT}`);
      expect(root.textContent).not.toContain("1969-12-31");
      expect(root.textContent).not.toContain("1970-01-01");
    });
  });
});

describe("format on a Time the program keeps in a Set", () => {
  // A Set stores its elements as object keys, which are text; `filter` hands each one back as
  // the number it was added as, so `format` reads the instant rather than the digits.
  it("keeps an element whose year filter reads through format", async () => {
    const shape = await loadSource(`
slot days : Set(Time) = {}
slot kept : Int = -1
reducer go on=ui.click(Go)
    do= kept := days.add(Time.parse("2026-03-07T10:00:00Z").get-or(now)).filter($1.format("yyyy") == "2026").size
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ do: { dispatch: "go" }, expect: { noErrors: true } }],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(shape.live?.kept).toBe(1);
  });
});

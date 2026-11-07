import { feature } from "@kumikijs/examples";
import { _stdlib, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { freshRoot, texts, waitUntil, withMounted } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

const PATTERN = "yyyy-MM-dd HH:mm";

describe("Decoder.Json reads a Time field's text by Time.parse's grammar", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  /** What example 198 shows once its stamps request answers one stamp at `at`. */
  async function shownFor(at: string): Promise<string[]> {
    double = stubFetch(() => new Response(JSON.stringify([{ label: "row", at }])));
    const app = await loadApp(feature("198-time-from-text"));
    return withMounted(app, async (root) => {
      await waitUntil(() => texts(root).some((l) => /^row: |^problem: \S/.test(l)), {
        timeoutMs: 3000,
      });
      return texts(root);
    });
  }

  it.each([
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
  ])("reads %j as Time.parse does, refusing what it refuses", async (at) => {
    const shown = await shownFor(at);
    const parsed = _stdlib.parseTime(at);
    if (parsed._tag === "Some") {
      expect(shown).toContain(`row: ${_stdlib.formatTime(parsed._0, PATTERN)}`);
    } else {
      expect(shown).toContain("problem: decode failed: expected Time at [0].at");
      expect(shown.some((l) => l.startsWith("row: "))).toBe(false);
    }
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

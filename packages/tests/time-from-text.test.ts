// A `Time` is read from text by one grammar, ISO 8601's calendar date with an
// optional time and zone (stdlib.md §2.2.8), wherever the runtime reads one:
// `Time.parse`, `T.parse` on a type over `Time`, and `format` on a `Time` a
// JSON payload filled with text, which `Decoder.Json` does not convert. The
// payload here goes through the real HTTP handler and decoder.
//
// The suite runs on America/Los_Angeles (vitest.config.ts), where a
// millisecond after the epoch is the evening of 1969-12-31.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _stdlib, type AppShape, mount, runScenario } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "198-time-from-text.kumiki");

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitUntil(done: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await tick(5);
  }
}

/** The text of every rendered element, one entry per leaf, in document order. */
function lines(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("*"))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent ?? "");
}

describe("format reads a Time held as text by Time.parse's grammar", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
  });

  it("renders each decoded text as Time.parse reads it, so digits are no instant", async () => {
    // Each row's `at` is the text itself. A text `Time.parse` reads renders as
    // that instant; one it refuses renders as no instant does — not as the
    // millisecond count `Number` reads from digits, and not as the day the
    // platform's parser makes of a month name.
    const texts = [
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
    const rows = texts.map((at, i) => ({ label: `row${i}`, at }));
    double = stubFetch(() => new Response(JSON.stringify(rows)));
    const app: AppShape = await loadApp(EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const { dispose } = mount(app, root);
    try {
      await waitUntil(() => lines(root).some((l) => l.startsWith(`row${texts.length - 1}: `)));
      const pattern = "yyyy-MM-dd HH:mm";
      const noInstant = _stdlib.formatTime(Number.NaN, pattern);
      texts.forEach((text, i) => {
        const parsed = _stdlib.parseTime(text);
        const expected =
          parsed._tag === "Some" ? _stdlib.formatTime(parsed._0, pattern) : noInstant;
        expect(lines(root), text).toContain(`row${i}: ${expected}`);
      });
      // The issue's own text, stated apart from `parseTime`'s answer.
      expect(lines(root)).toContain(`row0: ${noInstant}`);
      expect(root.textContent).not.toContain("1969-12-31");
      expect(root.textContent).not.toContain("1970-01-01");
    } finally {
      dispose();
      root.remove();
    }
  });
});

describe("T.parse on a type over Time reads the same grammar", () => {
  it("is None for the text the platform's parser reads as a day, and Some for ISO 8601", async () => {
    const shape = await loadSource(`
type Stamp = nominal Time
slot digit   : Option(Stamp) = None
slot words   : Option(Stamp) = None
slot month   : Option(Stamp) = None
slot weekday : Option(Stamp) = None
slot utc     : Option(Stamp) = None
reducer go on=ui.click(Go)
    do= digit   := Stamp.parse("1")
        words   := Stamp.parse("hello 12")
        month   := Stamp.parse("March 7")
        weekday := Stamp.parse("Tue 5")
        utc     := Stamp.parse("2026-03-07T10:00:00Z")
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const report = await runScenario(shape, root, {
        steps: [{ do: { dispatch: "go" }, expect: { noErrors: true } }],
      });
      expect(report.ok, JSON.stringify(report.steps)).toBe(true);
      expect(shape.live).toMatchObject({
        digit: { _tag: "None" },
        words: { _tag: "None" },
        month: { _tag: "None" },
        weekday: { _tag: "None" },
        utc: { _tag: "Some", _0: Date.UTC(2026, 2, 7, 10) },
      });
    } finally {
      root.remove();
    }
  });
});

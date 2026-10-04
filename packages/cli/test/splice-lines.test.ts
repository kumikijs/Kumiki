// `spliceLines` is how the write verbs put their lines into a file: it edits
// the text in place instead of splitting it into lines and joining them back
// with `\n`, which rewrote the end of every line in a CRLF file.
//
// The join is the oracle. On an LF text the splice must give its bytes for
// every range the store can hand it — including the empty range a definition
// sharing its first line with the next one gets — and on a CRLF text the same
// lines, ended with CRLF.

import { describe, expect, it } from "vitest";
import { lineSpan, spliceLines } from "../src/store.ts";

const TEXTS = ["", "a", "a\n", "\n", "a\nb", "a\nb\n", "a\n\nb\n", "a\nb\nc", "\n\n"];
const WRITTEN: string[][] = [[], [""], ["x"], ["x", "y"], ["x\ny"]];

/** Every `[from, to]` the store can produce for `text`: a range of its lines, or an empty one. */
function ranges(text: string): Array<[number, number]> {
  const count = text.split("\n").length;
  const out: Array<[number, number]> = [];
  for (let from = 1; from <= count; from++) {
    for (let to = from - 1; to <= count; to++) out.push([from, to]);
  }
  return out;
}

/** What the verbs wrote before: the lines around the range, joined with `eol`. */
function joined(text: string, from: number, to: number, written: string[], eol: string): string {
  const lines = text.split("\n");
  return [...lines.slice(0, from - 1), ...written, ...lines.slice(to)]
    .join("\n")
    .split("\n")
    .join(eol);
}

describe("spliceLines", () => {
  it("on an LF text, writes the bytes the join wrote", () => {
    for (const text of TEXTS) {
      for (const [from, to] of ranges(text)) {
        for (const written of WRITTEN) {
          expect(
            spliceLines(text, from, to, written),
            JSON.stringify({ text, from, to, written }),
          ).toBe(joined(text, from, to, written, "\n"));
        }
      }
    }
  });

  it("on a CRLF text, writes the same lines with CRLF", () => {
    // A text with no line break has no CRLF to keep; it gets `\n`, as above.
    for (const text of TEXTS.filter((t) => t.includes("\n"))) {
      const crlf = text.replace(/\n/g, "\r\n");
      for (const [from, to] of ranges(text)) {
        for (const written of WRITTEN) {
          expect(
            spliceLines(crlf, from, to, written),
            JSON.stringify({ crlf, from, to, written }),
          ).toBe(joined(text, from, to, written, "\r\n"));
        }
      }
    }
  });

  it("keeps each line's own line break in a text that has both", () => {
    const text = "a\r\nb\nc\r\nd\ne";
    // Line 3's CRLF stays after the line written in place of lines 2-3.
    expect(spliceLines(text, 2, 3, ["x"])).toBe("a\r\nx\r\nd\ne");
    // Lines written take the first line break in the text.
    expect(spliceLines(text, 4, 4, ["x", "y"])).toBe("a\r\nb\nc\r\nx\r\ny\ne");
    // A line removed takes its own line break with it.
    expect(spliceLines(text, 2, 2, [])).toBe("a\r\nc\r\nd\ne");
    // The last lines removed take the line break before them.
    expect(spliceLines(text, 3, 5, [])).toBe("a\r\nb");
  });

  it("writes a line break inside a written line as the text's", () => {
    expect(spliceLines("a\r\nb\r\n", 1, 1, ["x\ny", "z\r\nw"])).toBe("x\r\ny\r\nz\r\nw\r\nb\r\n");
    expect(spliceLines("a\nb\n", 1, 1, ["x\r\ny"])).toBe("x\ny\nb\n");
  });

  it("refuses a range the text does not have", () => {
    expect(() => spliceLines("a\nb", 3, 3, ["x"])).toThrow(
      "lines 3 to 3 are not lines of the text",
    );
    expect(() => spliceLines("a\nb", 1, 3, ["x"])).toThrow(
      "lines 1 to 3 are not lines of the text",
    );
    expect(() => spliceLines("a\nb", 2, 0, ["x"])).toThrow(
      "lines 2 to 0 are not lines of the text",
    );
  });
});

describe("lineSpan", () => {
  it("spans each line as the store splits it, without its line break", () => {
    for (const text of [...TEXTS, "a\r\nb", "a\r\n\r\nb\r\n", "a\r\r\nb", "\r\n", "a\rb\nc"]) {
      const lines = text.split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        const span = lineSpan(text, i + 1);
        expect(
          span && text.slice(span.start, span.end),
          JSON.stringify({ text, line: i + 1 }),
        ).toBe(line);
      }
      expect(lineSpan(text, 0)).toBeNull();
      expect(lineSpan(text, lines.length + 1)).toBeNull();
    }
  });
});

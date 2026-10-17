import { _stdlib } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

describe("Time.format and Time.parse", () => {
  const at = new Date(2026, 7, 14, 21, 5, 9).getTime();
  const two = (n: number) => String(n).padStart(2, "0");
  const d = new Date(at);

  it("substitutes each field the spec names", () => {
    expect(_stdlib.formatTime(at, "yyyy-MM-dd HH:mm")).toBe(
      `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`,
    );
    expect(_stdlib.formatTime(at, "ss")).toBe(two(d.getSeconds()));
  });

  it("copies through anything that is not a token", () => {
    expect(_stdlib.formatTime(at, "on dd/MM/yyyy at HH:mm:ss")).toBe(
      `on ${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} at ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`,
    );
    expect(_stdlib.formatTime(at, "")).toBe("");
  });

  it("reads the instant in local time", () => {
    expect(_stdlib.formatTime(at, "dd")).toBe(two(d.getDate()));
    expect(_stdlib.formatTime(at, "HH")).toBe(two(d.getHours()));
  });

  it("reads an instant that arrived as text", () => {
    const iso = "2026-08-14T21:05:09";
    const asDate = new Date(iso);
    expect(_stdlib.formatTime(iso, "yyyy-MM-dd HH:mm")).toBe(
      `${asDate.getFullYear()}-${two(asDate.getMonth() + 1)}-${two(asDate.getDate())} ${two(asDate.getHours())}:${two(asDate.getMinutes())}`,
    );
    expect(_stdlib.formatTime(` ${iso}\n`, "yyyy-MM-dd HH:mm")).toBe(
      _stdlib.formatTime(iso, "yyyy-MM-dd HH:mm"),
    );
  });

  it("reads text by Time.parse's grammar and no other", () => {
    const pattern = "yyyy-MM-dd HH:mm";
    const noInstant = _stdlib.formatTime(Number.NaN, pattern);
    for (const text of [
      "1",
      "12",
      "-1",
      "1e3",
      "0x10",
      "2026",
      "20260814",
      String(at),
      "hello 12",
      "March 7",
      "Tue 5",
      "Aug 14 2026",
      "2026-02-30",
      "2026-08-14T21:05+0900",
    ]) {
      expect(_stdlib.parseTime(text)._tag, text).toBe("None");
      expect(_stdlib.formatTime(text, pattern), text).toBe(noInstant);
    }
    for (const text of [
      "2026-08-14",
      "2026-08-14T21:05",
      "2026-08-14 21:05:09.5",
      "2026-08-14T21:05Z",
      "2026-08-14t21:05:09.250z",
      "2026-08-14T21:05+09:00",
    ]) {
      const parsed = _stdlib.parseTime(text) as { _tag: string; _0: number };
      expect(parsed._tag, text).toBe("Some");
      expect(_stdlib.formatTime(text, pattern), text).toBe(_stdlib.formatTime(parsed._0, pattern));
    }
  });

  it("reads a date-only string on the same clock it renders", () => {
    const parsed = _stdlib.parseTime("2026-08-14");
    expect(parsed._tag).toBe("Some");
    expect((parsed as { _0: number })._0).toBe(new Date(2026, 7, 14).getTime());
    expect(_stdlib.formatTime((parsed as { _0: number })._0, "yyyy-MM-dd")).toBe("2026-08-14");
  });

  it("still reads a full datetime the way the platform does", () => {
    const iso = "2026-08-14T21:05:09";
    expect((_stdlib.parseTime(iso) as { _0: number })._0).toBe(new Date(iso).getTime());
  });

  it("is None for text that names no instant", () => {
    for (const bad of ["", "   ", "nonsense"]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("is None for a date outside the calendar, which the platform rolls over", () => {
    // `new Date(2026, 1, 30)` is March 2nd and `Date.parse` does the same to a
    // datetime, so each of these used to be `Some` of a different day.
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2027-02-29",
      "2026-02-30T10:00",
      "2026-02-30 10:00",
      "2026-02-30Z",
      "2026-02-30t10:00",
      "+002026-02-30",
      "2026-2-30",
      "2026/02/30",
    ]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("still reads the last day of each month, and Feb 29th of a leap year", () => {
    for (const [text, y, m, d] of [
      ["2026-02-28", 2026, 1, 28],
      ["2028-02-29", 2028, 1, 29],
      ["2000-02-29", 2000, 1, 29],
      ["2026-12-31", 2026, 11, 31],
    ] as const) {
      expect(_stdlib.parseTime(text), text).toEqual({
        _tag: "Some",
        _0: new Date(y, m, d).getTime(),
      });
    }
  });

  it("reads a year below 100 as itself, not as 19xx", () => {
    // `new Date(50, 0, 1)` is 1950; the calendar check reads the year as
    // written, so the instant has to be that year too.
    for (const [text, year] of [
      ["0050-01-01", 50],
      ["0050-01-01T10:00", 50],
      ["0050-01-01 10:00", 50],
      ["0004-02-29 10:00", 4],
    ] as const) {
      const parsed = _stdlib.parseTime(text) as { _0: number };
      expect(new Date(parsed._0).getFullYear(), text).toBe(year);
    }
  });

  it("still reads a datetime on a boundary date", () => {
    for (const [text, y, m, d] of [
      ["2028-02-29T10:00", 2028, 1, 29],
      ["2026-02-28 10:00", 2026, 1, 28],
      ["2000-02-29T10:00", 2000, 1, 29],
      ["2026-12-31 10:00", 2026, 11, 31],
    ] as const) {
      expect(_stdlib.parseTime(text), text).toEqual({
        _tag: "Some",
        _0: new Date(y, m, d, 10).getTime(),
      });
    }
  });

  it("reads the ISO 8601 time part: seconds, a fraction, and a zone", () => {
    for (const [text, expected] of [
      ["2026-08-14T21:05", new Date(2026, 7, 14, 21, 5).getTime()],
      ["2026-08-14t21:05:09", new Date(2026, 7, 14, 21, 5, 9).getTime()],
      ["2026-08-14 21:05:09.5", new Date(2026, 7, 14, 21, 5, 9, 500).getTime()],
      ["2026-08-14T21:05:09.123456", new Date(2026, 7, 14, 21, 5, 9, 123).getTime()],
      ["2026-08-14Z", Date.UTC(2026, 7, 14)],
      ["2026-08-14T21:05Z", Date.UTC(2026, 7, 14, 21, 5)],
      ["2026-08-14T21:05:09.250z", Date.UTC(2026, 7, 14, 21, 5, 9, 250)],
      ["2026-08-14T21:05+09:00", Date.UTC(2026, 7, 14, 12, 5)],
      ["2026-08-14T21:05:09-07:30", Date.UTC(2026, 7, 15, 4, 35, 9)],
      ["2026-08-14 21:05:09.5+09:00", Date.UTC(2026, 7, 14, 12, 5, 9, 500)],
      ["2026-08-14 21:05Z", Date.UTC(2026, 7, 14, 21, 5)],
      // `Date.UTC(50, …)` would be 1950; the year is the one written.
      ["0050-01-01T10:00Z", new Date(Date.UTC(2000, 0, 1, 10)).setUTCFullYear(50)],
    ] as const) {
      expect(_stdlib.parseTime(text), text).toEqual({ _tag: "Some", _0: expected });
    }
  });

  it("is None for text that is not ISO 8601 YYYY-MM-DD with an optional time", () => {
    for (const bad of [
      "Aug 14 2026",
      "14 August 2026 10:00",
      "2026-08-14T",
      "2026-08-14T21",
      "2026-08-14T2:05",
      "2026-08-14T24:00",
      "2026-08-14T21:60",
      "2026-08-14T21:05:60",
      "2026-08-14T21:05:09.",
      "2026-08-14T21:05+0900",
      "2026-08-14T21:05+24:00",
      "2026-08-14T21:05 Z",
      "2026-08-14  21:05",
      "2026-08-14T21:05:09Z ",
      "+002026-08-14",
      "-000001-01-01",
      "12026-08-14",
      "2026-08",
      "2026",
    ]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("is None for the other forms ISO 8601 has", () => {
    for (const bad of [
      "2026-08-14T21Z",
      "2026-08-14T21+09:00",
      "2026-08-14T21:05:09,5",
      "2026-08-14T21:05+09",
      "2016-12-31T23:59:60Z",
      "20260814",
      "20260814T2105Z",
      "2026-W33-5",
      "2026-226",
    ]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("is None for text the platform's fallback parser reads as a day", () => {
    // V8 reads each of these as a day in 2001; the answer must not depend on the engine.
    for (const bad of [
      "1",
      "12",
      "hello 12",
      "March 7",
      "Tue 5",
      "03/07/2026",
      "Sat, 07 Mar 2026 10:00:00 GMT",
    ]) {
      expect(_stdlib.parseTime(bad)._tag, bad).toBe("None");
    }
  });

  it("is None for surrounding blanks, as the other readings are", () => {
    for (const bad of [" 2026-02-28", "2026-02-28 ", "\t2026-02-28", " 2026-02-28T10:00"]) {
      expect(_stdlib.parseTime(bad)._tag, JSON.stringify(bad)).toBe("None");
    }
  });

  it("does not render a blank as the epoch", () => {
    for (const blank of [null, undefined, "", "   "]) {
      expect(_stdlib.formatTime(blank, "yyyy-MM-dd"), String(blank)).toContain("NaN");
    }
    expect(_stdlib.formatTime(0, "yyyy")).toBe(String(new Date(0).getFullYear()));
  });

  it("keeps MM and mm apart", () => {
    const nov = new Date(2026, 10, 3, 0, 45, 0).getTime();
    expect(_stdlib.formatTime(nov, "MM mm")).toBe("11 45");
  });

  it.skipIf(new Date().getTimezoneOffset() === 0)("renders the local day, not the UTC one", () => {
    const evening = new Date(2026, 7, 14, 21, 0, 0);
    const local = evening.getTime();
    expect(_stdlib.formatTime(local, "dd HH")).toBe(
      `${two(evening.getDate())} ${two(evening.getHours())}`,
    );
    expect(_stdlib.formatTime(local, "dd HH")).not.toBe(
      `${two(evening.getUTCDate())} ${two(evening.getUTCHours())}`,
    );
  });
});

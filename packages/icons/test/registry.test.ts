import { describe, expect, it } from "vitest";
import { ALL_ICONS, check, ICON_NAMES, plus } from "../src/index.ts";

describe("@kumikijs/icons", () => {
  it("exports named SVG path data for documented icons", () => {
    expect(typeof check).toBe("string");
    expect(check.length).toBeGreaterThan(0);
    expect(typeof plus).toBe("string");
    expect(plus.length).toBeGreaterThan(0);
  });

  it("groups every named export into ALL_ICONS keyed by spec-form name", () => {
    expect(ALL_ICONS.check).toBe(check);
    expect(ALL_ICONS["check-circle"]).toBeDefined();
    expect(ALL_ICONS["external-link"]).toBeDefined();
  });

  it("ICON_NAMES lists at least 60 names and is sorted", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(60);
    const sorted = [...ICON_NAMES].sort();
    expect(ICON_NAMES).toEqual(sorted);
  });

  it("every ALL_ICONS value starts with an SVG move command", () => {
    for (const [name, d] of Object.entries(ALL_ICONS)) {
      expect(d, `${name} should be a valid SVG path-d`).toMatch(/^[Mm]/);
    }
  });
});

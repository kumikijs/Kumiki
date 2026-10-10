import { vi } from "vitest";

/** Silence `console[level]` and collect each call as one joined line; undone by `vi.restoreAllMocks()`. */
export function captureConsole(level: "error" | "warn" | "log" = "error"): string[] {
  const lines: string[] = [];
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

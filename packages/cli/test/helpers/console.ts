import { vi } from "vitest";

/** What a run returned, and what it printed: each stream's lines, and all of them in order. */
export type Printed<T> = {
  result: T;
  /** `console.log`, joined by newlines. */
  out: string;
  /** `console.error`, joined by newlines. */
  err: string;
  /** `console.warn`, joined by newlines. */
  warned: string;
  /** `console.log` and `console.error`, one entry per call, in the order they were made. */
  lines: string[];
};

/** Run `run` with the console silenced, and return what it printed. */
export async function printed<T>(run: () => T | Promise<T>): Promise<Printed<T>> {
  const calls = { log: [] as string[], error: [] as string[], warn: [] as string[] };
  const lines: string[] = [];
  const spies = (["log", "error", "warn"] as const).map((stream) =>
    vi.spyOn(console, stream).mockImplementation((m: unknown) => {
      calls[stream].push(String(m));
      if (stream !== "warn") lines.push(String(m));
    }),
  );
  try {
    const result = await run();
    return {
      result,
      out: calls.log.join("\n"),
      err: calls.error.join("\n"),
      warned: calls.warn.join("\n"),
      lines,
    };
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

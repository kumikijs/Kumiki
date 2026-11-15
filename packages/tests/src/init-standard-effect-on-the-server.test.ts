import { feature } from "@kumikijs/examples";
import { renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a compiled init that emits a standard effect, served by renderToString", () => {
  it("is skipped without a report, so the bootstrap episode completes", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const app = await loadApp(feature("263-init-standard-effect-on-the-server"));

    const { snapshot } = await renderToString(app);

    expect(errors).toEqual([]);
    expect(snapshot.bootstrap.status).toBe("completed");
  });
});

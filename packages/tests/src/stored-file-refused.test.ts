import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { click, find, mountApp, pickFile, waitUntil } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("273-stored-file-refused");

const sessionApp = (): Promise<AppShape> =>
  loadSource(readFileSync(EXAMPLE, "utf8").replaceAll("storage.", "session."));

describe("a write of a picked File is refused, and stores nothing (example 273)", () => {
  it.each([
    ["storage.write", "localStorage", () => loadApp(EXAMPLE), () => localStorage],
    ["session.write", "sessionStorage", sessionApp, () => sessionStorage],
  ] as const)("%s over %s", async (cap, backend, load, storage) => {
    const { root, handle } = mountApp(await load());
    const page = () => root.textContent ?? "";
    try {
      const file = new File([new Uint8Array([104, 105])], "a.txt", { type: "text/plain" });
      pickFile(find<HTMLInputElement>(root, 'input[type="file"]'), file);
      click(root, "Save");
      await waitUntil(() => !page().includes("shown: idle"));
      expect(page()).toContain(
        `shown: not saved: ${cap}: the value for "f" holds the File "a.txt", and ${backend} would keep only its name, size and type, not the file; nothing was stored`,
      );
      expect(storage().getItem("f")).toBeNull();

      click(root, "Load");
      await waitUntil(() => page().includes("shown: nothing stored"));
    } finally {
      handle.dispose();
      root.remove();
    }
  });
});

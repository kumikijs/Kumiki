// Issue #87 — runtime/compiler file-upload tier: prove the picker → blob URL
// path end-to-end. smoke.test.ts and examples.test.ts already cover "compiles
// and mounts", but neither one carries a real `File` through the `change`
// event, so the `$event.files.head` plumbing and `file-url()` lowering need a
// dedicated assertion here.
//
// Shape: load the 43-file-upload-preview example, mount it, hand a synthetic
// File to the `input[type=file]`, fire `change`, and assert an `<img>` shows
// up with a `blob:` src.
//
// happy-dom does not implement URL.createObjectURL; we stub it for the test
// run only (the real browser already provides it, so smoke under Chromium
// would not need the stub).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, "..", "examples", "features", "43-file-upload-preview.kumiki");

let originalCreateObjectURL: typeof URL.createObjectURL | undefined;

beforeAll(() => {
  if (typeof URL.createObjectURL !== "function") {
    originalCreateObjectURL = URL.createObjectURL;
    let n = 0;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      void blob;
      n += 1;
      return `blob:happy-dom/${n}`;
    };
  }
});

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("file upload — input(type=file) + $event.files + file-url()", () => {
  it("picking a file replaces None with Some(File) and renders a blob URL preview", async () => {
    const app = await loadApp(examplePath);
    const root = document.createElement("div");
    document.body.appendChild(root);

    const handle = mount(app, root);
    try {
      const input = root.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input, "file input must be in the DOM").not.toBeNull();
      if (!input) return;

      expect(input.getAttribute("accept")).toBe("image/*");
      expect(root.querySelector("img")).toBeNull();

      const file = new File([new Uint8Array([1, 2, 3])], "avatar.png", {
        type: "image/png",
      });
      // happy-dom respects assignment to `.files` via a FileList-like array;
      // fall back to defineProperty if that path is not supported.
      try {
        Object.defineProperty(input, "files", {
          configurable: true,
          value: [file] as unknown as FileList,
        });
      } catch {
        (input as unknown as { files: File[] }).files = [file];
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const img = root.querySelector<HTMLImageElement>("img");
      expect(img, "preview <img> must appear after picking a file").not.toBeNull();
      expect(img?.getAttribute("src") ?? "").toMatch(/^blob:/);
    } finally {
      handle.dispose();
    }
  });
});

// Keep the linter happy about the stash variable in environments that already
// have createObjectURL — we only restore when we stubbed.
void originalCreateObjectURL;

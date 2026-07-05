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
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { mount } from "@kumikijs/runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, "..", "examples", "features", "43-file-upload-preview.kumiki");

// happy-dom does not provide URL.createObjectURL; the runtime guards on its
// absence with an empty string. For this test we need a non-empty `blob:`
// URL to assert on, so stash whatever the environment has (typically
// undefined) and install a stub for the duration of the file.
const originalCreateObjectURL = URL.createObjectURL;
const stubbed = typeof originalCreateObjectURL !== "function";

beforeAll(() => {
  if (stubbed) {
    let n = 0;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      void blob;
      n += 1;
      return `blob:happy-dom/${n}`;
    };
  }
});

afterAll(() => {
  if (stubbed) {
    (URL as { createObjectURL: typeof URL.createObjectURL }).createObjectURL =
      originalCreateObjectURL;
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

      // Re-renders must reuse the same blob URL: rerender via the live app
      // helper and assert the <img> src is unchanged. Without WeakMap-based
      // memoisation each render would mint a fresh URL and the old one
      // would leak.
      const firstSrc = img?.getAttribute("src") ?? "";
      (app as { _rerender?: () => void })._rerender?.();
      const imgAfter = root.querySelector<HTMLImageElement>("img");
      expect(imgAfter?.getAttribute("src") ?? "").toBe(firstSrc);
    } finally {
      handle.dispose();
    }
  });

  it("typechecks File metadata fields (.name / .size / .type)", () => {
    // Regression: keeping `File` in SCALAR_PRIMS without naming its fields
    // raised E0108 the moment a reducer touched the metadata the runtime
    // already returns. Compile a tiny program that reads all three.
    const src = `
slot pickedName : Text = ""
slot pickedSize : Int  = 0
slot pickedType : Text = ""
slot avatar : Option(File) = None

tile Picker = input(type="file")

reducer pickFile
    on=ui.change(Picker)
    do= avatar := $event.files.head
        pickedName := $event.files.head.get.name
        pickedSize := $event.files.head.get.size
        pickedType := $event.files.head.get.type

tile App = column(Picker)

app FileFieldsRegression
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const result = compile(src, {
      runtimeSpecifier: "./runtime.js",
      bundle: false,
      readRuntimeBundle: nodeRuntimeBundleReader,
    });
    if (result.kind !== "ok") {
      throw new Error(
        `File field access must typecheck:\n${result.errors
          .map((e) => `  ${e.code} @ ${e.pos.line}:${e.pos.col}: ${e.message}`)
          .join("\n")}`,
      );
    }
  });
});

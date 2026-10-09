import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { feature } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const examplePath = feature("43-file-upload-preview");

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

      const firstSrc = img?.getAttribute("src") ?? "";
      (app as { _rerender?: () => void })._rerender?.();
      const imgAfter = root.querySelector<HTMLImageElement>("img");
      expect(imgAfter?.getAttribute("src") ?? "").toBe(firstSrc);
    } finally {
      handle.dispose();
    }
  });

  it("typechecks File metadata fields (.name / .size / .type)", () => {
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

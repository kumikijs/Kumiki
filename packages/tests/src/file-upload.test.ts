import { feature } from "@kumikijs/examples";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { find, mountApp } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

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

const avatar = (): File =>
  new File(["png"], "avatar.png", {
    type: "image/png",
  });

/** Pick `file` in `input` as the browser's file chooser would. */
function pick(input: HTMLInputElement, file: File): void {
  try {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file] as unknown as FileList,
    });
  } catch {
    (input as unknown as { files: File[] }).files = [file];
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("file upload — input(type=file) + $event.files + file-url()", () => {
  it("picking a file replaces None with Some(File) and renders a blob URL preview", async () => {
    const app = await loadApp(examplePath);
    const { root, handle } = mountApp(app);
    try {
      const input = find<HTMLInputElement>(root, 'input[type="file"]');
      expect(input.getAttribute("accept")).toBe("image/*");
      expect(root.querySelector("img")).toBeNull();

      pick(input, avatar());

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

  it("reads .name / .size / .type of a picked File", async () => {
    const app = await loadSource(`
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

app FileFields
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const { root, handle } = mountApp(app);
    try {
      pick(find<HTMLInputElement>(root, 'input[type="file"]'), avatar());
      expect(app.live).toMatchObject({
        pickedName: "avatar.png",
        pickedSize: avatar().size,
        pickedType: "image/png",
      });
    } finally {
      handle.dispose();
    }
  });
});

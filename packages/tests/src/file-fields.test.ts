import { generateDts, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { click, find, mountApp, pickFile, waitUntil } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const hiTxt = (): File => new File([new Uint8Array([104, 105])], "hi.txt", { type: "text/plain" });

async function pick(file: File) {
  const app = await loadApp(feature("197-file-fields"));
  const { root, handle } = mountApp(app);
  pickFile(find<HTMLInputElement>(root, 'input[type="file"]'), file);
  return { root, handle, live: defined(app.live, "the app's live map") };
}

/** The fields the generated declaration gives a `File`, read from the table the checker reads. */
function declaredFileFields(): string[] {
  const dts = generateDts(
    parse(
      lex(`effect e cap=custom.file in=File out=Result(Unit, Text)
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`),
    ),
  );
  const line = dts.split("\n").find((l) => l.includes('"custom.file"')) ?? "";
  const record = /Provider<\{([^}]*)\}/.exec(line)?.[1] ?? "";
  return record
    .split(";")
    .map((field) => field.split(":")[0]?.trim() ?? "")
    .filter((name) => name !== "")
    .sort();
}

describe("a file input reports each picked file as a File", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
    document.body.replaceChildren();
  });

  it("carries name, size and type and no other field", async () => {
    const { handle, live } = await pick(hiTxt());
    try {
      expect(live.picked).toMatchObject({ _tag: "Some" });
      const record = (live.picked as { _0: Record<string, unknown> })._0;
      // `_`-prefixed keys are the runtime's bookkeeping; the checker lets no program read them.
      const visible = Object.keys(record).filter((k) => !k.startsWith("_"));
      const declared = declaredFileFields();
      expect(declared).toContain("name");
      expect(visible.sort()).toEqual(declared);
      expect(record).toMatchObject({ name: "hi.txt", size: 2, type: "text/plain" });
    } finally {
      handle.dispose();
    }
  });

  it("sends the picked file's bytes as the FileV part of a Multipart body", async () => {
    double = stubFetch(() => Response.json({ url: "/files/hi.txt" }));
    const { root, handle, live } = await pick(hiTxt());
    try {
      click(root, "Upload");
      await waitUntil(() => live.sentTo === "/files/hi.txt");
      expect(double.calls).toHaveLength(1);
      const body = double.calls[0]?.init.body;
      expect(body).toBeInstanceOf(FormData);
      const part = (body as FormData).get("file");
      expect(part).toBeInstanceOf(Blob);
      expect([...new Uint8Array(await (part as Blob).arrayBuffer())]).toEqual([104, 105]);
    } finally {
      handle.dispose();
    }
  });
});

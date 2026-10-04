// A `File`'s fields are written down once, in the `File` row of stdlib.md
// §2.1.3, and implemented three times: the checker types `f.<field>` from its
// field table, `generateDts` declares a `File` at a capability boundary from
// the same table, and the runtime's file input builds one record per picked
// file. Each is compared here with the row as both spec tracks write it, so a
// field added to or dropped from any one of them fails this file rather than a
// program written to the spec.
//
// The bytes of a file are not a field (the row says how they are reached). The
// last case drives that path through `197-file-fields`: a picked file's bytes
// reach the request `upload` makes, as the `FileV` part of its `Multipart`
// body.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, generateDts, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const EXAMPLE = join(here, "..", "examples", "features", "197-file-fields.kumiki");

const TRACKS = {
  en: join(repoRoot, "docs", "spec", "stdlib.md"),
  ja: join(repoRoot, "docs", "ja", "spec", "stdlib.md"),
} as const;

type Field = { name: string; type: string };

/** The `File` row of §2.1.3, field by field, in the order the row writes them. */
function specFileFields(path: string): Field[] {
  const md = readFileSync(path, "utf8");
  const start = md.indexOf("### 2.1.3 ");
  if (start === -1) throw new Error(`${path} has no §2.1.3`);
  const end = md.indexOf("\n## ", start);
  const section = md.slice(start, end === -1 ? undefined : end);
  const row = /^\| `File` \| `\{([^}`]*)\}`/m.exec(section);
  const body = defined(row?.[1], `the \`File\` row of ${path} §2.1.3`);
  return body.split(",").map((piece) => {
    const [name = "", type = ""] = piece.split(":").map((s) => s.trim());
    return { name, type };
  });
}

const ROW = specFileFields(TRACKS.en);

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const codes = (src: string): string[] => check(parse(lex(src))).map((e) => e.code);

describe("the File row of stdlib.md §2.1.3", () => {
  it("lists the same fields on both tracks", () => {
    // Also the extraction floor: a row the pattern misread would be empty or
    // carry a blank name, and every comparison below would compare nothing.
    expect(ROW.length).toBeGreaterThan(0);
    for (const f of ROW) expect(f.name, JSON.stringify(f)).toMatch(/^[a-z][a-z-]*$/);
    expect(specFileFields(TRACKS.ja)).toEqual(ROW);
  });
});

describe("the checker reads a File's fields as the row types them", () => {
  for (const { name, type } of ROW) {
    it(`reads ${name} as ${type}`, () => {
      expect(codes(`fn get(f: File) -> ${type} = f.${name}\n${TAIL}`)).toEqual([]);
      // Any other result type is a mismatch, so the field is read at `type`
      // rather than at whatever accepts every declaration.
      const other = type === "Bool" ? "Text" : "Bool";
      expect(codes(`fn get(f: File) -> ${other} = f.${name}\n${TAIL}`)).toEqual(["E0201"]);
    });
  }

  it("reports a field the row does not list, the file's bytes included", () => {
    expect(ROW.map((f) => f.name)).not.toContain("content");
    expect(codes(`fn get(f: File) -> Bytes = f.content\n${TAIL}`)).toEqual(["E0108"]);
    // A name every JavaScript object answers is not a field either.
    expect(codes(`fn get(f: File) -> Text = f.constructor\n${TAIL}`)).toEqual(["E0108"]);
  });
});

describe("a capability boundary declares a File as the row", () => {
  // The TypeScript a Kumiki primitive becomes at the boundary (dts.ts).
  const TS: Record<string, string> = { Text: "string", Int: "number", Bytes: "Uint8Array" };

  it("names exactly the row's fields, at their types", () => {
    const line = generateDts(
      parse(lex(`effect e cap=custom.thing in=File out=Result(Unit, Text)\n${TAIL}`)),
    )
      .split("\n")
      .find((l) => l.includes('"custom.thing"'));
    const declared = `{ ${ROW.map((f) => `${f.name}: ${TS[f.type] ?? `<${f.type}>`}`).join("; ")} }`;
    expect(line).toContain(`Provider<${declared},`);
  });
});

describe("a file input reports each picked file as the row", () => {
  let double: FetchDouble | undefined;

  afterEach(() => {
    double?.restore();
    double = undefined;
    document.body.replaceChildren();
  });

  /** Mount the example and pick `file` through its input, as a user would. */
  async function pick(file: File) {
    const app = await loadApp(EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mount(app, root);
    const input = defined(
      root.querySelector<HTMLInputElement>('input[type="file"]'),
      "the example's file input",
    );
    // A file input's `files` cannot be assigned; this is how a test puts a
    // file in it.
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const live = defined(app.live, "the app's live map");
    return { root, handle, live };
  }

  it("carries the row's fields and no other", async () => {
    const { handle, live } = await pick(
      new File([new Uint8Array([104, 105])], "hi.txt", { type: "text/plain" }),
    );
    try {
      expect(live.picked).toMatchObject({ _tag: "Some" });
      const record = (live.picked as { _0: Record<string, unknown> })._0;
      // `_`-prefixed keys are the runtime's own bookkeeping (`_file` holds the
      // DOM File that `file-url` and a `FileV` part read), as `_tag` / `_0`
      // are on a variant; nothing a program writes can name one.
      const visible = Object.keys(record).filter((k) => !k.startsWith("_"));
      expect(visible.sort()).toEqual(ROW.map((f) => f.name).sort());
      expect(record).toMatchObject({ name: "hi.txt", size: 2, type: "text/plain" });
    } finally {
      handle.dispose();
    }
  });

  it("sends the picked file's bytes as the FileV part of a Multipart body", async () => {
    double = stubFetch(() => Response.json({ url: "/files/hi.txt" }));
    const { root, handle, live } = await pick(
      new File([new Uint8Array([104, 105])], "hi.txt", { type: "text/plain" }),
    );
    try {
      defined(root.querySelector<HTMLButtonElement>("#upload"), "the Upload button").click();
      await new Promise((r) => setTimeout(r, 30));
      expect(double.calls).toHaveLength(1);
      const body = double.calls[0]?.init.body;
      expect(body).toBeInstanceOf(FormData);
      const part = (body as FormData).get("file");
      expect(part).toBeInstanceOf(Blob);
      expect([...new Uint8Array(await (part as Blob).arrayBuffer())]).toEqual([104, 105]);
      expect(live.sentTo).toBe("/files/hi.txt");
    } finally {
      handle.dispose();
    }
  });
});

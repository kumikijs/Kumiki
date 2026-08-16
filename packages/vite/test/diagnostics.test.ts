// What the author sees when a `.kumiki` file does not compile. A type error
// already arrived as a located diagnostic; a *parse* error — the likelier
// mistake while typing — escaped the transform as a raw exception, so Vite's
// overlay showed the file with no line, followed by eight frames of compiler
// internals. The two failures now read alike.
//
// The capability manifest is here for the same reason: a lookup that misses
// says where it looked.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kumiki, type KumikiPluginOptions } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TMP = join(here, "test-tmp");
mkdirSync(TMP, { recursive: true });

type Reported = {
  message: string;
  id?: string;
  loc?: { file: string; line: number; column: number };
};

/** Run the transform with a context that records what `this.error` was given. */
async function failureOf(src: string, file: string, opts?: KumikiPluginOptions): Promise<Reported> {
  const plugin = kumiki(opts);
  const t = plugin.transform;
  const fn = typeof t === "function" ? t : t?.handler;
  if (!fn) throw new Error("plugin has no transform hook");
  let reported: Reported | undefined;
  const ctx = {
    error(e: unknown): never {
      reported = typeof e === "string" ? { message: e } : (e as Reported);
      throw new Error("ctx.error");
    },
    warn(): void {},
  };
  await expect(fn.call(ctx as never, src, file)).rejects.toThrow();
  if (!reported) throw new Error("transform failed without calling ctx.error");
  return reported;
}

describe("a source that does not parse", () => {
  const BAD_PARSE = `tile App = column(text("x")\napp A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

  it("reports the position the parser stopped at", async () => {
    const r = await failureOf(BAD_PARSE, "/abs/bad.kumiki");
    expect(r.loc).toEqual({ file: "/abs/bad.kumiki", line: 2, column: 1 });
    expect(r.id).toBe("/abs/bad.kumiki");
  });

  it("says what is wrong and where, without compiler internals", async () => {
    const r = await failureOf(BAD_PARSE, "/abs/bad.kumiki");
    expect(r.message).toContain("/abs/bad.kumiki");
    expect(r.message).toContain("Expected");
    expect(r.message).not.toContain("at Parser.");
    expect(r.message).not.toContain("compiler/src/parser.ts");
  });

  it("reports a lexer failure the same way", async () => {
    const r = await failureOf(`tile App = column(text("unterminated)\n`, "/abs/lex.kumiki");
    expect(r.loc).toMatchObject({ file: "/abs/lex.kumiki", line: 1 });
    expect(r.message).toContain("Unterminated string");
    expect(r.message).not.toContain("at Lexer");
  });

  it("reports a nesting-depth refusal where the parser stopped", async () => {
    const deep = `tile App = ${"box(".repeat(400)}text("x")${")".repeat(400)}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const r = await failureOf(deep, "/abs/deep.kumiki");
    expect(r.message).toContain("Nesting is deeper than");
    expect(r.loc?.file).toBe("/abs/deep.kumiki");
    expect(r.message).not.toContain("at Parser.");
  });

  it("leaves a type error's diagnostic as it was", async () => {
    const r = await failureOf(
      `tile App = column(text(nope))\napp A caps=[] routes={"/" -> App, "/404" -> App} init=[]`,
      "/abs/type.kumiki",
    );
    expect(r.message).toContain("Kumiki compile failed");
    expect(r.message).toContain("E0103");
    expect(r.loc?.file).toBe("/abs/type.kumiki");
  });
});

describe("the capability manifest a project actually has", () => {
  const CUSTOM_CAP_APP = `
    slot sent : Int = 0
    effect track cap=telemetry.track in={name: Text} out=Unit
    reducer fire on=ui.click(B) do= emit track({name: "x"})
    tile B = button(text="b")
    tile App = column(B, text(sent.show))
    app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
  `;

  /** `<root>/src/app.kumiki`, with `<root>/package.json`. */
  function project(): { root: string; file: string } {
    const root = mkdtempSync(join(TMP, "caps-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p" }));
    const file = join(root, "src", "app.kumiki");
    writeFileSync(file, CUSTOM_CAP_APP);
    return { root, file };
  }

  async function transform(file: string, src: string): Promise<string> {
    const plugin = kumiki();
    const t = plugin.transform;
    const fn = typeof t === "function" ? t : t?.handler;
    const ctx = {
      error(e: unknown): never {
        throw new Error(typeof e === "string" ? e : (e as { message: string }).message);
      },
      warn(): void {},
    };
    const out = (await fn?.call(ctx as never, src, file)) as { code: string };
    return out.code;
  }

  it("accepts a manifest at the project root, not only beside the source", async () => {
    const p = project();
    writeFileSync(
      join(p.root, "kumiki.caps.json"),
      JSON.stringify({ capabilities: ["telemetry.track"] }),
    );
    expect(await transform(p.file, CUSTOM_CAP_APP)).toContain("export default App;");
  });

  it("names the directories it searched when no manifest was found", async () => {
    const p = project();
    const r = await failureOf(CUSTOM_CAP_APP, p.file);
    expect(r.message).toContain("E0302");
    expect(r.message).toContain("kumiki.caps.json");
    expect(r.message).toContain(join(p.root, "src"));
    expect(r.message).toContain(p.root);
  });

  it("names the manifest it used when one was found but lacks the capability", async () => {
    const p = project();
    const manifest = join(p.root, "kumiki.caps.json");
    writeFileSync(manifest, JSON.stringify({ capabilities: ["telemetry.identify"] }));
    const r = await failureOf(CUSTOM_CAP_APP, p.file);
    expect(r.message).toContain("E0302");
    expect(r.message).toContain(manifest);
  });

  it("reports a malformed manifest as a located failure, not a thrown exception", async () => {
    const p = project();
    writeFileSync(join(p.root, "kumiki.caps.json"), "{ not json");
    const r = await failureOf(CUSTOM_CAP_APP, p.file);
    expect(r.message).toContain("kumiki.caps.json");
    expect(r.message).toContain("invalid JSON");
    expect(r.id).toBe(p.file);
  });
});

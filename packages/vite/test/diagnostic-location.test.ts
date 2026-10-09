// Where the overlay puts its caret. The compiler counts columns from 1, as
// `kumiki check` prints them; Rollup's `loc.column` counts from 0, and Vite's
// code frame adds it to the offset of the line's start. Each case drives a real
// dev server, so the assertion is on the frame an author actually sees, not on
// an object the plugin built.

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createLogger, createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";
import { scratchRoot } from "./helpers/scratch.ts";

const TMP = scratchRoot(import.meta.url);

const APP = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Serve `src` as `/bad.kumiki`; collect what the transform threw and warned. */
async function serve(src: string): Promise<{ thrown: unknown; warnings: string[] }> {
  const root = mkdtempSync(join(TMP, "loc-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p" }));
  writeFileSync(join(root, "bad.kumiki"), src);
  const warnings: string[] = [];
  const logger = createLogger("warn");
  // Vite colours a warning when the terminal (or CI's FORCE_COLOR) asks for it,
  // which can split `file:line:col`; the text is what is asserted.
  logger.warn = (msg) => {
    warnings.push(stripVTControlCharacters(msg));
  };
  server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    customLogger: logger,
    plugins: [kumiki()],
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  let thrown: unknown;
  try {
    await server.transformRequest("/bad.kumiki");
  } catch (e) {
    thrown = e;
  }
  return { thrown, warnings };
}

/**
 * The source text from the frame's caret to the end of its line — what the
 * author's eye lands on. Vite renders `N  |  <line>` above `   |  <pad>^`.
 */
function underCaret(frame: string): string {
  const lines = stripVTControlCharacters(frame).split("\n");
  const at = lines.findIndex((l) => /^\s*\|\s*\^+\s*$/.test(l));
  if (at < 1) throw new Error(`no caret in frame:\n${frame}`);
  // Both rows share one gutter width, so a caret column is a source column.
  return (lines[at - 1] as string).slice((lines[at] as string).indexOf("^"));
}

type Located = { loc?: { line: number; column: number }; frame?: string };

describe("the overlay caret sits on the character the compiler reports", () => {
  it("for a check error, under the start of the undefined name", async () => {
    const { thrown } = await serve(`tile App = column(text(nope))\n${APP}\n`);
    const e = thrown as Located;
    expect(e.loc).toMatchObject({ line: 1, column: 23 });
    expect(underCaret(e.frame ?? "")).toMatch(/^nope\)\)/);
  });

  it("for a lex error, under the character the lexer rejected", async () => {
    const { thrown } = await serve(`tile App = column(text("a") ?\n${APP}\n`);
    const e = thrown as Located;
    expect(e.loc).toMatchObject({ line: 1, column: 28 });
    expect(underCaret(e.frame ?? "")).toBe("?");
  });

  it("for a parse error, under the token the parser stopped at", async () => {
    const { thrown } = await serve(`tile App = column(text("a") = 1)\n${APP}\n`);
    const e = thrown as Located;
    expect(e.loc).toMatchObject({ line: 1, column: 28 });
    expect(underCaret(e.frame ?? "")).toBe("= 1)");
  });

  it("for a warning, under the selector it is about", async () => {
    const src = [
      `slot b : Text = ""`,
      `reducer markBlur on=ui.blur(Card) do= b := "blurred"`,
      `tile Card = box(text("x"))`,
      `tile App = column(Card)`,
      APP,
      "",
    ].join("\n");
    const { thrown, warnings } = await serve(src);
    expect(thrown).toBeUndefined();
    const w = warnings.find((m) => m.includes("W0212"));
    if (!w) throw new Error(`no W0212 among warnings:\n${warnings.join("\n")}`);
    expect(w).toContain("bad.kumiki:2:20");
    expect(underCaret(w)).toMatch(/^ui\.blur\(Card\)/);
  });
});

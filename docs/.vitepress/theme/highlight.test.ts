import { describe, expect, it } from "vitest";
import { createKumikiHighlighter, overlayPad } from "./highlight";

// AC — playground editor syntax highlighting:
//  1. createKumikiHighlighter returns a function rendering kumiki source as
//     Shiki HTML (pre.shiki > code > span.line per line)
//  2. tokens carry BOTH theme colors as CSS variables (--shiki-light /
//     --shiki-dark) so VitePress's .dark class toggle can switch them
//  3. HTML-special characters in the source are escaped
//  4. every feature example in the repo highlights without throwing on the
//     JavaScript regex engine (grammar ⇆ engine compatibility)
//  5. overlayPad keeps the highlight backdrop the same height as the
//     textarea: a trailing newline gets a trailing space (an empty final
//     line would otherwise collapse); anything else is unchanged

const exampleModules = import.meta.glob("../../../packages/examples/features/*.kumiki", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("kumiki playground highlighter", () => {
  it("AC1: renders kumiki source as line-structured Shiki HTML", async () => {
    const highlight = await createKumikiHighlighter();
    const html = highlight(
      "slot count : Int = 0\nreducer inc on=ui.click(Btn) do= count := count + 1",
    );
    expect(html).toContain('<pre class="shiki');
    expect(html.match(/<span class="line">/g)).toHaveLength(2);
  });

  it("AC2: tokens carry light AND dark theme colors as CSS variables", async () => {
    const highlight = await createKumikiHighlighter();
    const html = highlight("slot count : Int = 0");
    expect(html).toMatch(
      /<span style="--shiki-light:#[0-9A-Fa-f]+;--shiki-dark:#[0-9A-Fa-f]+">slot<\/span>/,
    );
    // no hardcoded single-theme colors: defaultColor must be off
    expect(html).not.toMatch(/<span style="color:/);
  });

  it("AC3: escapes HTML-special characters in the source", async () => {
    const highlight = await createKumikiHighlighter();
    const html = highlight('tile A = text(label="<b>&</b>")');
    expect(html).not.toContain("<b>");
    // Shiki emits hex entities (&#x3C;); accept either spelling
    expect(html).toMatch(/&(#x3C|lt);b/);
    expect(html).toMatch(/&(#x26|amp);/);
  });

  // The cost is one highlighter build plus one pass per example, so it grows
  // with the corpus and sits near the default 5s ceiling. A timeout here has
  // never meant a broken grammar, only a cold start.
  it("AC4: highlights every feature example without throwing (JS regex engine)", {
    timeout: 30_000,
  }, async () => {
    const highlight = await createKumikiHighlighter();
    const entries = Object.entries(exampleModules);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, source] of entries) {
      expect(() => highlight(source), path).not.toThrow();
      expect(highlight(source), path).toContain('<pre class="shiki');
    }
  });

  it("AC5: overlayPad pads a trailing newline and leaves other code unchanged", () => {
    expect(overlayPad("slot x : Int = 0\n")).toBe("slot x : Int = 0\n ");
    expect(overlayPad("slot x : Int = 0")).toBe("slot x : Int = 0");
    expect(overlayPad("")).toBe("");
    expect(overlayPad("\n")).toBe("\n ");
  });
});

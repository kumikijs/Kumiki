import { kumikiGrammar } from "@kumikijs/syntax";
import { createHighlighterCore, type LanguageRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

export type Highlight = (code: string) => string;

export async function createKumikiHighlighter(): Promise<Highlight> {
  const highlighter = await createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [kumikiGrammar as unknown as LanguageRegistration],
    engine: createJavaScriptRegexEngine(),
  });
  return (code) =>
    highlighter.codeToHtml(code, {
      lang: "kumiki",
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
}

export function overlayPad(code: string): string {
  return code.endsWith("\n") ? `${code} ` : code;
}

# @kumikijs/syntax

TextMate grammar for the [Kumiki](https://github.com/kumikijs/Kumiki) language —
syntax highlighting for `.kumiki` files in Shiki, VitePress, VS Code, or any
TextMate-compatible highlighter.

The grammar is generated from the compiler's own vocabulary (keyword set,
`BUILTIN_TILES`, built-in types), so highlighting tracks the language.

## Install

```sh
pnpm add -D @kumikijs/syntax
```

## Usage

### Shiki / VitePress

```ts
import { defineConfig } from "vitepress";
import kumikiGrammar from "@kumikijs/syntax";

export default defineConfig({
  markdown: {
    languages: [kumikiGrammar],
  },
});
```

```ts
import { createHighlighter } from "shiki";
import kumikiGrammar from "@kumikijs/syntax";

const hl = await createHighlighter({ themes: ["github-dark"], langs: [kumikiGrammar] });
hl.codeToHtml(source, { lang: "kumiki", theme: "github-dark" });
```

### Raw grammar file

Tools that want a file path (e.g. a VS Code extension's
`contributes.grammars`) can resolve the published `.json` directly:

```jsonc
{
  "scopeName": "source.kumiki",
  "path": "./node_modules/@kumikijs/syntax/kumiki.tmLanguage.json"
}
```

The same file is reachable as the `@kumikijs/syntax/grammar.json` export.

## Scope

The grammar covers declarations (`type` / `slot` / `effect` / `reducer` /
`tile` / `fn` / `app` / `test` / `theme` / `motion`), clause keywords
(`on=` / `do=` / `cap=` …), control flow, built-in types and tiles, positional
bindings (`$1`, `$el`), method access, records, strings, numbers, and comments.

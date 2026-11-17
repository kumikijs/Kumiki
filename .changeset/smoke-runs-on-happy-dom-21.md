---
"@kumikijs/cli": patch
---

`kumiki smoke`, `run`, `test` and `replay` mount apps in happy-dom 21.0.4, which fixes the code-injection and SSRF advisories of the 20.x line

`@kumikijs/cli` depended on `@happy-dom/global-registrator` `^20.10.2`, which resolves to a
happy-dom affected by GHSA-834v-8h66-3h79 (code injection, fixed in 21.0.4), GHSA-c8p4-j97h-3vg8
(SSRF, fixed in 21.0.0) and GHSA-5fpq-26gf-qwcr (fixed in 20.14.6). It now depends on `^21.0.4`.
happy-dom 21 no longer loads external CSS files or iframe pages by default; the CLI loads neither.

---
"@kumikijs/icons": patch
---

docs: link the style spec relatively from the icons README.

The link pointed at an absolute `github.com/…/blob/main/…` URL, which a checkout
cannot follow and which pins the reader to whatever `main` happens to be. The
relative form resolves in an editor and on GitHub, and `repository.directory` is
set to `packages/icons`, which is what npm's renderer needs to rewrite it for the
package page.

Being honest about the one reader it does not serve: `files` ships `dist` only,
so nothing under `docs/` lands in the tarball and the path does not resolve from
`node_modules/@kumikijs/icons/README.md`. The absolute URL did work there. The
README ships regardless of `files`, so the change reaches npm on the next
release.

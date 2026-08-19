---
"@kumikijs/icons": patch
---

docs: link the style spec relatively from the icons README.

The link pointed at an absolute `github.com/…/blob/main/…` URL, which a
checkout cannot follow and which pins the reader to whatever `main` happens to
be. The relative form resolves in an editor, on GitHub, and on the npm package
page alike. The README ships in the tarball, so the fix needs a release to
reach anyone reading it there.

---
"@kumikijs/cli": patch
---

`kumiki dev` runs on vite 8.3.8, out of the range of the dev-server advisories vite fixed in 8.1.6

`@kumikijs/cli` pinned vite to 8.0.16, which falls in the vulnerable range of GHSA-587h-7wmj-h5pm,
GHSA-rq7h-c2jc-7f22, GHSA-r825-w8mm-5pxw, GHSA-698v-4r3x-3vcv and GHSA-9jrq-w75r-8gcw. Its own
`rolldown` dependency now takes the range vite 8.3.8 declares (`~1.2.18`) instead of `1.0.3`, so an
install still resolves a single rolldown instead of two native toolchains.

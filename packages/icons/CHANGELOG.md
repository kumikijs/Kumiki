# @kumikijs/icons

## 0.2.0

### Minor Changes

- 301b09a: chore: require Node 24.

  Node 20 reached end of life, so every package's `engines.node` moves from
  `>=20` (`>=20.6` for `@kumikijs/vite`, which needs the synchronous
  `import.meta.resolve` that landed there) to `>=24`. CI builds and tests on 24
  as well, matching the release workflow, which was already there.

  **Breaking for anyone installing on Node 20 or 22**: the packages declare the
  new floor, so `npm i` warns and an `engine-strict` install fails. Nothing in
  the published code depends on a Node 24 API today — the bump states the
  version the toolchain is actually tested on, rather than one that no longer
  receives security fixes.

### Patch Changes

- 1be03d1: docs: link the style spec relatively from the icons README.

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

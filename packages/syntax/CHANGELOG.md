# @kumikijs/syntax

## 0.3.0

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

## 0.2.0

### Minor Changes

- 0784054: Add `@kumikijs/syntax`: a TextMate grammar for the Kumiki language, providing
  real syntax highlighting for `.kumiki` files in Shiki / VitePress / VS Code.
  The docs site now highlights Kumiki code blocks with this grammar instead of
  aliasing Rust.

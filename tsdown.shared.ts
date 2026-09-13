// Shared tsdown output settings for every published @kumikijs/* package.

/**
 * Comment retention for the published `.js` artifacts.
 *
 * JSDoc is dropped: it is the single largest thing in the unminified bundles
 * (39% of `@kumikijs/runtime`'s `dist/index.js` gzipped), and every consumer
 * that wants it reads it somewhere else — editors from the `.d.ts`, which
 * keeps its JSDoc, and humans from the source on GitHub.
 *
 * The two kinds a build *cannot* regenerate stay:
 *
 * - `annotation` — `@__PURE__` / `@__NO_SIDE_EFFECTS__` / `@vite-ignore`.
 *   Dropping these would silently cost downstream bundlers the tree-shaking
 *   this package's `sideEffects: false` promises.
 * - `legal` — `@license` / `@preserve` / `//!` / `/*!`, which must survive
 *   redistribution.
 *
 * This is not minification: identifiers, formatting and the `export { … }`
 * line are untouched, so `@kumikijs/runtime`'s `dist/index.js` stays readable
 * and inline-able (see that package's tsdown.config.ts).
 *
 * What reaches the output is narrower than this setting alone implies, and
 * worth stating because the name says "jsdoc": rolldown already dropped
 * authored `//` line comments before this option existed, so the only prose
 * that ever survived to `dist` was the `/** … *\/` blocks, and after this
 * none does. The 82 `//` lines left in `dist/index.js` are all rolldown's own
 * `#region` markers. `packages/tests/dist-comments.test.ts` pins both halves.
 */
export const publishedOutputOptions = {
  comments: { legal: true, annotation: true, jsdoc: false },
} as const;

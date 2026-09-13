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
 */
export const publishedOutputOptions = {
  comments: { legal: true, annotation: true, jsdoc: false },
} as const;

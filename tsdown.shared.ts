// The .js drops JSDoc, which editors read from the .d.ts. Annotations stay because consumers'
// tree-shaking under sideEffects: false needs them, and legal comments for their licenses.
export const publishedOutputOptions = {
  comments: { legal: true, annotation: true, jsdoc: false },
} as const;

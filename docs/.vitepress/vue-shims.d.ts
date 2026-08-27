// A `.vue` single-file component is not TypeScript, and its real types come
// from `vue-tsc` rather than `tsc`. The theme entry imports two of them and
// registers them by name; nothing here reads their props, so declaring the
// module costs the theme nothing and lets the rest of `.vitepress/` — the three
// test files included — be typechecked by the same `tsc` as every other
// package.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}

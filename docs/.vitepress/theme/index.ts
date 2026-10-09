import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import Demo from "./Demo.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component(
      "Playground",
      defineAsyncComponent(() => import("./Playground.vue")),
    );
    app.component(
      "Showcase",
      defineAsyncComponent(() => import("./Showcase.vue")),
    );
    app.component("KumikiDemo", Demo);
  },
} satisfies Theme;

import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { type AsyncComponentLoader, defineAsyncComponent, defineComponent, h } from "vue";
import Demo from "./Demo.vue";
import "./custom.css";

const LoadFailed = (what: string) =>
  defineComponent({
    props: { error: { type: Error, required: false } },
    setup: (props) => () =>
      h("p", { class: "custom-block danger", role: "alert" }, [
        `The ${what} could not be loaded${props.error ? ` (${props.error.message})` : ""}. `,
        "Reload the page to try again.",
      ]),
  });

const lazy = (what: string, loader: AsyncComponentLoader) =>
  defineAsyncComponent({ loader, errorComponent: LoadFailed(what) });

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component(
      "Playground",
      lazy("playground", () => import("./Playground.vue")),
    );
    app.component(
      "Showcase",
      lazy("showcase", () => import("./Showcase.vue")),
    );
    app.component("KumikiDemo", Demo);
  },
} satisfies Theme;

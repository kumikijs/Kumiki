<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { createKumikiHighlighter, type Highlight } from "./highlight";
import { type Lang, previewApp, showcaseApps } from "./showcase";

const props = withDefaults(defineProps<{ lang?: Lang }>(), { lang: "en" });

const TEXT = {
  en: { learn: "What it shows", source: "Source", lines: "lines", open: "Open in GitHub" },
  ja: { learn: "見どころ", source: "ソース", lines: "行", open: "GitHub で開く" },
} as const;
const t = computed(() => TEXT[props.lang]);

const apps = showcaseApps(props.lang);
const selected = ref(apps[0]?.name ?? "");
const app = computed(() => apps.find((a) => a.name === selected.value) ?? apps[0]);
const preview = computed(() => (app.value ? previewApp(app.value.name) : undefined));
const highlight = shallowRef<Highlight>();
const sourceHtml = computed(() =>
  app.value && highlight.value ? highlight.value(app.value.source) : "",
);
const repo = "https://github.com/kumikijs/Kumiki/tree/main/packages/examples/apps/";

const segments = (line: string) =>
  line.split("`").map((text, i) => ({ text, code: i % 2 === 1 }));

const detail = ref<HTMLElement>();

function choose(name: string): void {
  selected.value = name;
  if (!matchMedia("(min-width: 960px)").matches) detail.value?.scrollIntoView({ behavior: "smooth" });
}

function fromHash(): void {
  const name = decodeURIComponent(location.hash.slice(1));
  if (apps.some((a) => a.name === name)) selected.value = name;
}

watch(selected, (name) => {
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
});

onMounted(async () => {
  fromHash();
  window.addEventListener("hashchange", fromHash);
  highlight.value = await createKumikiHighlighter();
});
onBeforeUnmount(() => window.removeEventListener("hashchange", fromHash));
</script>

<template>
  <div class="ks">
    <nav class="ks-list" aria-label="Apps">
      <button
        v-for="a in apps"
        :key="a.name"
        type="button"
        class="ks-card"
        :aria-pressed="a.name === app?.name"
        @click="choose(a.name)"
      >
        <span class="ks-card-head">
          <span class="ks-card-title">{{ a.title }}</span>
          <span class="ks-card-lines">{{ a.lines }} {{ t.lines }}</span>
        </span>
        <span class="ks-card-summary"
          ><template v-for="(s, i) in segments(a.summary)" :key="i"
            ><code v-if="s.code">{{ s.text }}</code
            ><template v-else>{{ s.text }}</template></template
          ></span
        >
      </button>
    </nav>

    <section v-if="app" ref="detail" class="ks-detail">
      <header class="ks-detail-head">
        <h2 :id="app.name" class="ks-detail-title">{{ app.title }}</h2>
        <a :href="repo + app.name" target="_blank" rel="noreferrer">{{ t.open }}</a>
      </header>
      <div class="ks-frame">
        <iframe
          v-if="preview?.kind === 'ok'"
          :key="app.name"
          :srcdoc="preview.srcdoc"
          :title="app.title"
          sandbox="allow-scripts"
        ></iframe>
        <p v-else class="ks-msg">{{ preview?.kind === "err" ? preview.message : "" }}</p>
      </div>
      <template v-if="app.learn.length">
        <h3>{{ t.learn }}</h3>
        <ul>
          <li v-for="line in app.learn" :key="line">
            <template v-for="(s, i) in segments(line)" :key="i">
              <code v-if="s.code">{{ s.text }}</code><template v-else>{{ s.text }}</template>
            </template>
          </li>
        </ul>
      </template>
      <details class="ks-source">
        <summary>{{ t.source }} — app.kumiki</summary>
        <div v-if="sourceHtml" class="ks-code" v-html="sourceHtml"></div>
        <pre v-else class="ks-code"><code>{{ app.source }}</code></pre>
      </details>
    </section>
  </div>
</template>

<style scoped>
.ks {
  display: grid;
  gap: 24px;
  margin-top: 24px;
}
@media (min-width: 960px) {
  .ks {
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    align-items: start;
  }
  .ks-list {
    position: sticky;
    top: calc(var(--vp-nav-height) + 16px);
  }
}
.ks-list {
  display: grid;
  gap: 8px;
}
.ks-card {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  cursor: pointer;
  transition: border-color 0.15s;
}
.ks-card:hover {
  border-color: var(--vp-c-brand-2);
}
.ks-card[aria-pressed="true"] {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}
.ks-card-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}
.ks-card-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.ks-card-lines {
  flex: none;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.ks-card-summary {
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ks-detail {
  min-width: 0;
}
.ks-detail-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.ks-detail-title {
  margin: 0;
  padding: 0;
  border: 0;
}
.ks-frame {
  height: 520px;
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.ks-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.ks-msg {
  margin: 0;
  padding: 16px;
  height: 100%;
  color: var(--vp-c-danger-1);
  background: var(--vp-c-bg-soft);
}
.ks-source {
  margin-top: 16px;
}
.ks-source summary {
  cursor: pointer;
  font-weight: 600;
}
.ks-code {
  margin-top: 8px;
  max-height: 560px;
  overflow: auto;
  font-size: 13px;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
}
.ks-code :deep(pre) {
  margin: 0;
  padding: 16px;
}
pre.ks-code {
  padding: 16px;
}
.ks-code :deep(span) {
  color: var(--shiki-light);
}
.dark .ks-code :deep(span) {
  color: var(--shiki-dark);
}
</style>

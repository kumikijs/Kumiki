<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { createKumikiHighlighter, type Highlight, overlayPad } from "./highlight";
import { createPlayground, type Diagnostic } from "./playground";
import { examples, PREVIEW_SANDBOX } from "./preview";
import { type ModelContext, playgroundToolHost } from "./webmcp";

const defaultExample = examples.find((e) => e.name.startsWith("01"));
const DEFAULT_SOURCE =
  defaultExample?.source ??
  'slot count : Int = 0\n\nreducer inc on=ui.click(IncBtn) do= count := count + 1\n\ntile IncBtn = button(text="+1", onClick=inc)\ntile App = column(heading("Count: " + count.show), IncBtn)\n\napp Playground\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []\n';

const source = ref(DEFAULT_SOURCE);
const diagnostics = shallowRef<Diagnostic[]>([]);
const srcdoc = ref("");
const selected = ref(defaultExample?.name ?? "");

const playground = createPlayground((view) => {
  source.value = view.source;
  diagnostics.value = view.diagnostics;
  srcdoc.value = view.srcdoc;
});

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  source,
  (src) => {
    if (selected.value && examples.find((e) => e.name === selected.value)?.source !== src) {
      selected.value = "";
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => playground.preview(src), 250);
  },
  { immediate: false },
);

watch(selected, (name) => {
  if (name) playground.loadExample(name);
});

const ok = computed(() => srcdoc.value.length > 0);

const highlight = shallowRef<Highlight | null>(null);
const backdropEl = ref<HTMLElement | null>(null);
const highlighted = computed(() =>
  highlight.value ? highlight.value(overlayPad(source.value)) : "",
);

function syncScroll(event: Event): void {
  const ta = event.target as HTMLTextAreaElement;
  const backdrop = backdropEl.value;
  if (!backdrop) return;
  backdrop.scrollTop = ta.scrollTop;
  backdrop.scrollLeft = ta.scrollLeft;
}

onMounted(() => {
  playground.preview(source.value);
  const mc = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  playgroundToolHost.bind(mc, playground);
  createKumikiHighlighter().then(
    (h) => {
      highlight.value = h;
    },
    (e) => console.warn("[playground] syntax highlight unavailable:", e),
  );
});
onBeforeUnmount(() => playgroundToolHost.release(playground));
</script>

<template>
  <div class="sp">
    <div class="sp-bar">
      <select v-model="selected" aria-label="Choose an example">
        <option value="">Choose an example…</option>
        <option v-for="e in examples" :key="e.name" :value="e.name">{{ e.name }}</option>
      </select>
      <span class="sp-status" :class="ok ? 'ok' : 'err'">
        {{ ok ? "✓ Compiled" : diagnostics.length ? "✗ Diagnostics" : "…" }}
      </span>
    </div>
    <div class="sp-grid">
      <div class="sp-editor" :class="{ 'sp-lit': highlighted }">
        <div ref="backdropEl" class="sp-backdrop" aria-hidden="true" v-html="highlighted"></div>
        <textarea
          v-model="source"
          class="sp-input"
          spellcheck="false"
          aria-label="Kumiki source"
          @scroll="syncScroll"
        ></textarea>
      </div>
      <div class="sp-preview">
        <ul v-if="diagnostics.length" class="sp-diags">
          <li v-for="(d, i) in diagnostics" :key="i" :class="d.severity">
            <code>{{ d.code }}</code> {{ d.message }}
            <span class="sp-pos">({{ d.line }}:{{ d.col }})</span>
          </li>
        </ul>
        <iframe v-if="ok" :srcdoc="srcdoc" title="preview" :sandbox="PREVIEW_SANDBOX"></iframe>
        <p v-else-if="!diagnostics.length">…</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp { border: 1px solid var(--vp-c-divider); border-radius: 8px; overflow: hidden; }
.sp-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; background: var(--vp-c-bg-soft); border-bottom: 1px solid var(--vp-c-divider);
}
.sp-bar select { padding-inline: 8px }
.sp-status.ok { color: var(--vp-c-green-1); }
.sp-status.err { color: var(--vp-c-red-1); }
.sp-grid { display: grid; grid-template-columns: 1fr 1fr; min-height: 360px; }
.sp-editor {
  position: relative; display: grid;
  background: var(--vp-c-bg); border-right: 1px solid var(--vp-c-divider);
}
.sp-input, .sp-backdrop {
  margin: 0; padding: 12px; box-sizing: border-box;
  font-family: var(--vp-font-family-mono); font-size: 13px; line-height: 1.5;
  white-space: pre; overflow-wrap: normal; tab-size: 4;
}
.sp-input {
  position: relative; z-index: 1; display: block;
  width: 100%; height: 100%; min-height: 360px; border: 0; resize: vertical;
  background: transparent; color: var(--vp-c-text-1); caret-color: var(--vp-c-text-1);
  overflow: auto;
}
.sp-lit .sp-input { color: transparent; }
.sp-backdrop { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.sp-backdrop :deep(pre.shiki) {
  margin: 0; padding: 0; background: transparent !important;
  font: inherit; line-height: inherit;
}
.sp-backdrop :deep(code) { display: block; font: inherit; line-height: inherit; }
.sp-backdrop :deep(span) { color: var(--shiki-light); }
.dark .sp-backdrop :deep(span) { color: var(--shiki-dark); }
.sp-preview { display: flex; flex-direction: column; background: var(--vp-c-bg); overflow: auto; }
.sp-preview iframe { flex: 1; width: 100%; min-height: 360px; border: 0; background: #fff; }
.sp-diags { margin: 0; padding: 12px 12px 12px 28px; }
.sp-diags + iframe { border-top: 1px solid var(--vp-c-divider); }
.sp-diags .error, .sp-diags .error code { color: var(--vp-c-red-1); }
.sp-diags .warning, .sp-diags .warning code { color: var(--vp-c-warning-1); }
.sp-pos { color: var(--vp-c-text-2); }
@media (max-width: 768px) { .sp-grid { grid-template-columns: 1fr; } }
</style>

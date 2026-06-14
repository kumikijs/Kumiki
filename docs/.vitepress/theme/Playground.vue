<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { check, lex, parse } from "@kumikijs/compiler";
import { createKumikiHighlighter, type Highlight, overlayPad } from "./highlight";
import { buildSrcdoc, capabilities, compileToJs, examples } from "./preview";
import { type ModelContext, type PlaygroundApi, playgroundToolHost } from "./webmcp";

type Diag = { code: string; kind: string; message: string; line: number; col: number };

const defaultExample = examples.find((e) => e.name.startsWith("01"));
const DEFAULT_SOURCE =
  defaultExample?.source ??
  'slot count : Int = 0\n\nreducer inc on=ui.click(IncBtn) do= count := count + 1\n\ntile IncBtn = button(text="+1", onClick=inc)\ntile App = column(heading("Count: " + count.show), IncBtn)\n\napp Playground\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []\n';

const source = ref(DEFAULT_SOURCE);
const diagnostics = shallowRef<Diag[]>([]);
const srcdoc = ref("");
// The select mirrors what the editor holds: it starts on the example the
// editor is seeded with, and falls back to the placeholder as soon as the
// source is edited away from the selected example.
const selected = ref(defaultExample?.name ?? "");

function diagnose(src: string): Diag[] {
  try {
    const program = parse(lex(src));
    return check(program, { capabilities }).map((e) => ({
      code: e.code,
      kind: e.kind,
      message: e.message,
      line: e.pos.line,
      col: e.pos.col,
    }));
  } catch (e) {
    const pe = e as { message?: string; pos?: { line: number; col: number } };
    return [
      {
        code: "E0000",
        kind: "parse-error",
        message: pe.message ?? String(e),
        line: pe.pos?.line ?? 0,
        col: pe.pos?.col ?? 0,
      },
    ];
  }
}

function buildPreview(src: string): void {
  const diags = diagnose(src);
  diagnostics.value = diags;
  if (diags.length > 0) {
    srcdoc.value = "";
    return;
  }
  const result = compileToJs(src);
  if (result.kind === "fail") {
    diagnostics.value = result.errors.map((e) => ({
      code: e.code,
      kind: e.kind,
      message: e.message,
      line: e.pos.line,
      col: e.pos.col,
    }));
    srcdoc.value = "";
    return;
  }
  srcdoc.value = buildSrcdoc(result.js);
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  source,
  (src) => {
    if (selected.value && examples.find((e) => e.name === selected.value)?.source !== src) {
      selected.value = "";
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => buildPreview(src), 250);
  },
  { immediate: false },
);

function loadExample(name: string): boolean {
  const ex = examples.find((e) => e.name === name);
  if (!ex) return false;
  source.value = ex.source;
  buildPreview(ex.source);
  return true;
}

watch(selected, (name) => {
  if (name) loadExample(name);
});

const ok = computed(() => diagnostics.value.length === 0 && srcdoc.value.length > 0);

// --- Syntax highlight: a Shiki-rendered backdrop sits behind a transparent
// textarea (same font metrics, scroll-synced). Until the highlighter loads —
// or if it fails — the textarea keeps its normal text color.
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

// --- WebMCP: expose the playground as tools for in-browser AI agents ---
// Registration goes through the page-global host (see webmcp.ts): tools are
// registered at most once per page load and delegated to the currently
// mounted instance, so SPA revisits of this page can't hit the
// "Duplicate tool name" InvalidStateError.
const webMcpApi: PlaygroundApi = {
  compileSource(src) {
    const diags = diagnose(src);
    if (diags.length > 0) return { ok: false, diagnostics: diags };
    const r = compileToJs(src);
    return r.kind === "ok"
      ? { ok: true, jsBytes: r.js.length }
      : { ok: false, diagnostics: r.errors };
  },
  listExamples: () => examples.map((e) => e.name),
  loadExample,
  setSource(src) {
    source.value = src;
    buildPreview(src);
    return diagnostics.value.length === 0 ? "ok" : JSON.stringify(diagnostics.value);
  },
};

onMounted(() => {
  buildPreview(source.value);
  const mc = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  playgroundToolHost.bind(mc, webMcpApi);
  createKumikiHighlighter().then(
    (h) => {
      highlight.value = h;
    },
    (e) => console.warn("[playground] syntax highlight unavailable:", e),
  );
});
onBeforeUnmount(() => playgroundToolHost.release(webMcpApi));
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
        <iframe v-if="ok" :srcdoc="srcdoc" title="preview" sandbox="allow-scripts"></iframe>
        <ul v-else-if="diagnostics.length" class="sp-diags">
          <li v-for="(d, i) in diagnostics" :key="i">
            <code>{{ d.code }}</code> {{ d.message }}
            <span class="sp-pos">({{ d.line }}:{{ d.col }})</span>
          </li>
        </ul>
        <p v-else>…</p>
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
/* Backdrop and textarea must share identical text metrics so the highlighted
   text sits exactly under the (transparent) editor text. */
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
.sp-preview { background: #fff; overflow: auto; }
.sp-preview iframe { width: 100%; height: 100%; min-height: 360px; border: 0; }
.sp-diags { margin: 0; padding: 12px 12px 12px 28px; color: var(--vp-c-red-1); }
.sp-diags code { color: var(--vp-c-red-1); }
.sp-pos { color: var(--vp-c-text-2); }
@media (max-width: 768px) { .sp-grid { grid-template-columns: 1fr; } }
</style>

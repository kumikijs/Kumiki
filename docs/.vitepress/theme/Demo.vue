<script setup lang="ts">
import { onMounted, ref } from "vue";

const props = withDefaults(defineProps<{ example: string; height?: string }>(), {
  height: "240px",
});

const srcdoc = ref("");
const sandbox = ref("");
const error = ref("");

onMounted(async () => {
  try {
    // Imported here rather than at the top so the compiler stays out of every page's eager chunk.
    const { compileExample, PREVIEW_SANDBOX } = await import("./preview");
    const result = compileExample(props.example);
    sandbox.value = PREVIEW_SANDBOX;
    if (result.kind === "ok") srcdoc.value = result.srcdoc;
    else error.value = result.message;
  } catch (e) {
    error.value = String(e);
  }
});
</script>

<template>
  <div class="kd" :style="{ height: props.height }">
    <iframe
      v-if="srcdoc"
      :srcdoc="srcdoc"
      :title="`Live demo: ${props.example}`"
      :sandbox="sandbox"
    ></iframe>
    <p v-else-if="error" class="kd-msg">demo unavailable: {{ error }}</p>
    <p v-else class="kd-msg">loading demo…</p>
  </div>
</template>

<style scoped>
.kd {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  margin: 16px 0;
}
.kd iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.kd-msg {
  margin: 0;
  padding: 16px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  height: 100%;
}
</style>

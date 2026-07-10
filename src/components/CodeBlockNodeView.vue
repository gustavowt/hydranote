<template>
  <node-view-wrapper class="code-block-node">
    <button
      type="button"
      class="code-copy-btn"
      :class="{ copied }"
      contenteditable="false"
      :title="copied ? 'Copied' : 'Copy code'"
      aria-label="Copy code"
      @mousedown.prevent
      @click.prevent="copyCode"
    >
      <svg v-if="!copied" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </button>
    <pre><node-view-content as="code" :class="languageClass" /></pre>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';

const props = defineProps(nodeViewProps);

const copied = ref(false);
let resetTimer: number | undefined;

const languageClass = computed(() => {
  const lang = props.node.attrs.language as string | null;
  return lang ? `language-${lang}` : '';
});

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.node.textContent);
  } catch {
    return;
  }
  copied.value = true;
  window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}

onBeforeUnmount(() => {
  window.clearTimeout(resetTimer);
});
</script>

<style scoped>
.code-block-node {
  position: relative;
}

.code-copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--hn-border-default);
  background: var(--hn-bg-elevated);
  color: var(--hn-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
  z-index: 1;
}

.code-block-node:hover .code-copy-btn,
.code-copy-btn:focus-visible {
  opacity: 1;
}

.code-copy-btn:hover {
  color: var(--hn-text-primary);
  background: var(--hn-bg-hover);
}

.code-copy-btn.copied {
  color: var(--hn-teal);
  opacity: 1;
}

/* Touch devices have no hover: keep the button visible at reduced opacity */
@media (hover: none) {
  .code-copy-btn {
    opacity: 0.6;
  }
}
</style>

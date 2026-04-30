<template>
  <node-view-wrapper class="mermaid-block-node" :data-mermaid-source="source">
    <div v-if="!editing" class="mermaid-render" @click="startEditing">
      <div ref="renderEl" class="mermaid-svg-container"></div>
      <div v-if="error" class="mermaid-error">{{ error }}</div>
    </div>
    <div v-else class="mermaid-source-edit">
      <textarea
        ref="textareaRef"
        v-model="draft"
        class="mermaid-source-textarea"
        spellcheck="false"
        @blur="commitEdit"
        @keydown.escape.prevent="cancelEdit"
        @keydown.meta.enter.prevent="commitEdit"
        @keydown.ctrl.enter.prevent="commitEdit"
      ></textarea>
      <div class="mermaid-edit-hint">
        <span>Mermaid source</span>
        <span class="hint-keys">⌘/Ctrl+Enter to apply · Esc to cancel</span>
      </div>
    </div>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import mermaid from 'mermaid';

const props = defineProps(nodeViewProps);

const editing = ref(false);
const draft = ref('');
const renderEl = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const error = ref('');

const source = computed<string>(() => (props.node.attrs.source as string) || '');

let renderToken = 0;

async function renderDiagram() {
  if (!renderEl.value) return;
  const code = source.value.trim();
  if (!code) {
    renderEl.value.innerHTML = '<span class="mermaid-empty">Empty mermaid block</span>';
    error.value = '';
    return;
  }
  const myToken = ++renderToken;
  const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const { svg } = await mermaid.render(id, code);
    if (myToken !== renderToken) return; // stale render; skip
    renderEl.value.innerHTML = svg;
    error.value = '';
  } catch (e) {
    if (myToken !== renderToken) return;
    error.value = e instanceof Error ? e.message : 'Invalid Mermaid syntax';
    renderEl.value.innerHTML = '';
  }
}

function startEditing() {
  if (!props.editor.isEditable) return;
  draft.value = source.value;
  editing.value = true;
  nextTick(() => {
    textareaRef.value?.focus();
    textareaRef.value?.select();
  });
}

function commitEdit() {
  if (!editing.value) return;
  if (draft.value !== source.value) {
    props.updateAttributes({ source: draft.value });
  }
  editing.value = false;
}

function cancelEdit() {
  editing.value = false;
}

watch(source, () => {
  if (!editing.value) renderDiagram();
});

onMounted(() => {
  renderDiagram();
});

onBeforeUnmount(() => {
  renderToken++; // invalidate any pending render
});
</script>

<style scoped>
.mermaid-block-node {
  margin: 1.5em 0;
  border-radius: 8px;
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  overflow: hidden;
}

.mermaid-render {
  padding: 16px;
  cursor: pointer;
  display: flex;
  justify-content: center;
  min-height: 60px;
}

.mermaid-render:hover {
  background: var(--hn-bg-hover);
}

.mermaid-svg-container {
  max-width: 100%;
  overflow-x: auto;
}

.mermaid-svg-container :deep(svg) {
  max-width: 100%;
  height: auto;
}

.mermaid-empty {
  color: var(--hn-text-muted);
  font-style: italic;
}

.mermaid-error {
  color: var(--hn-danger);
  font-family: 'SF Mono', monospace;
  font-size: 0.85em;
  padding: 8px 12px;
  background: var(--hn-danger-muted);
  border-radius: 4px;
  margin-top: 8px;
  white-space: pre-wrap;
}

.mermaid-source-edit {
  display: flex;
  flex-direction: column;
}

.mermaid-source-textarea {
  width: 100%;
  min-height: 140px;
  background: var(--hn-bg-deepest);
  color: var(--hn-text-primary);
  border: none;
  padding: 14px 16px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.mermaid-edit-hint {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--hn-bg-elevated);
  color: var(--hn-text-muted);
  font-size: 0.75em;
  border-top: 1px solid var(--hn-border-default);
}

.hint-keys {
  font-family: 'SF Mono', monospace;
}
</style>

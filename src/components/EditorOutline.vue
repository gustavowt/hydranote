<template>
  <aside
    v-if="items.length > 0"
    class="editor-outline"
    :class="{ collapsed: !visible }"
    :aria-label="visible ? 'Document outline' : 'Document outline (collapsed)'"
  >
    <div class="outline-header">
      <span v-if="visible" class="outline-title">Outline</span>
      <button
        type="button"
        class="outline-toggle"
        @click="$emit('toggle')"
        :title="visible ? 'Hide outline' : 'Show outline'"
        :aria-expanded="visible"
      >
        {{ visible ? '‹' : '›' }}
      </button>
    </div>
    <nav v-if="visible" class="outline-list">
      <button
        v-for="(item, index) in items"
        :key="`${item.startOffset}-${index}`"
        type="button"
        class="outline-item"
        :class="`level-${item.level}`"
        @click="$emit('navigate', item, index)"
      >
        {{ item.title }}
      </button>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { parseDocumentStructure } from '@/services/documentProcessor';
import type { DocumentSection } from '@/types';

export interface OutlineItem {
  level: number;
  title: string;
  startOffset: number;
  startLine: number;
}

const props = defineProps<{
  content: string;
  visible: boolean;
}>();

defineEmits<{
  (e: 'navigate', item: OutlineItem, index: number): void;
  (e: 'toggle'): void;
}>();

const items = computed<OutlineItem[]>(() => {
  const sections = parseDocumentStructure(props.content);
  return sections
    .filter((s: DocumentSection) => s.type === 'heading' && s.level && s.title)
    .map((s) => ({
      level: s.level!,
      title: s.title!,
      startOffset: s.startOffset,
      startLine: s.startLine,
    }));
});
</script>

<style scoped>
.editor-outline {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--hn-border-default, #333);
  background: var(--hn-bg-surface, #1a1a2e);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.editor-outline.collapsed {
  width: 28px;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 8px 6px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--hn-text-secondary, #888);
  border-bottom: 1px solid var(--hn-border-default, #333);
  min-height: 36px;
  box-sizing: border-box;
}

.editor-outline.collapsed .outline-header {
  justify-content: center;
  padding: 8px 0;
  border-bottom: none;
}

.outline-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.outline-toggle {
  background: none;
  border: none;
  color: var(--hn-text-secondary, #888);
  cursor: pointer;
  font-size: 1rem;
  padding: 0 4px;
  flex-shrink: 0;
  line-height: 1;
}

.outline-toggle:hover {
  color: var(--hn-text-primary, #eee);
}

.outline-list {
  overflow-y: auto;
  flex: 1;
  padding: 6px 0;
}

.outline-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--hn-text-primary, #eee);
  font-size: 0.8rem;
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-item:hover {
  background: var(--hn-bg-hover, rgba(255, 255, 255, 0.06));
}

.outline-item.level-1 { padding-left: 10px; font-weight: 600; }
.outline-item.level-2 { padding-left: 18px; }
.outline-item.level-3 { padding-left: 26px; }
.outline-item.level-4 { padding-left: 34px; }
.outline-item.level-5 { padding-left: 42px; }
.outline-item.level-6 { padding-left: 50px; font-size: 0.75rem; }
</style>

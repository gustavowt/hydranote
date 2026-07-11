<template>
  <div
    v-if="visible"
    class="table-bubble-menu"
    :style="menuStyle"
    @mousedown.prevent
  >
    <button type="button" title="Add row above" @click="run('addRowBefore')">
      <ion-icon :icon="arrowUpOutline" />
    </button>
    <button type="button" title="Add row below" @click="run('addRowAfter')">
      <ion-icon :icon="arrowDownOutline" />
    </button>
    <button type="button" title="Add column left" @click="run('addColumnBefore')">
      <ion-icon :icon="arrowBackOutline" />
    </button>
    <button type="button" title="Add column right" @click="run('addColumnAfter')">
      <ion-icon :icon="arrowForwardOutline" />
    </button>
    <button type="button" title="Delete row" @click="run('deleteRow')">
      <ion-icon :icon="removeOutline" />
    </button>
    <button type="button" title="Delete column" @click="run('deleteColumn')">
      <ion-icon :icon="closeOutline" />
    </button>
    <button type="button" class="danger" title="Delete table" @click="run('deleteTable')">
      <ion-icon :icon="trashOutline" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  arrowUpOutline,
  arrowDownOutline,
  arrowBackOutline,
  arrowForwardOutline,
  removeOutline,
  closeOutline,
  trashOutline,
} from 'ionicons/icons';
import type { Editor } from '@tiptap/core';

const props = defineProps<{
  editor: Editor | null;
}>();

const visible = ref(false);
const menuStyle = ref<Record<string, string>>({});

type TableCommand =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable';

function run(command: TableCommand): void {
  const editor = props.editor;
  if (!editor) return;

  const chain = editor.chain().focus();
  switch (command) {
    case 'addRowBefore':
      chain.addRowBefore().run();
      break;
    case 'addRowAfter':
      chain.addRowAfter().run();
      break;
    case 'addColumnBefore':
      chain.addColumnBefore().run();
      break;
    case 'addColumnAfter':
      chain.addColumnAfter().run();
      break;
    case 'deleteRow':
      chain.deleteRow().run();
      break;
    case 'deleteColumn':
      chain.deleteColumn().run();
      break;
    case 'deleteTable':
      chain.deleteTable().run();
      break;
  }
}

function updateMenu(): void {
  const editor = props.editor;
  if (!editor || !editor.isEditable) {
    visible.value = false;
    return;
  }

  if (!editor.isActive('table')) {
    visible.value = false;
    return;
  }

  const { view } = editor;
  const { from } = editor.state.selection;
  const coords = view.coordsAtPos(from);
  const editorRect = view.dom.getBoundingClientRect();

  menuStyle.value = {
    top: `${coords.top - editorRect.top - 40}px`,
    left: `${coords.left - editorRect.left}px`,
  };
  visible.value = true;
}

let editorInstance: Editor | null = null;

function attach(editor: Editor): void {
  detach();
  editorInstance = editor;
  editor.on('selectionUpdate', updateMenu);
  editor.on('transaction', updateMenu);
  editor.on('blur', () => {
    visible.value = false;
  });
  updateMenu();
}

function detach(): void {
  if (!editorInstance) return;
  editorInstance.off('selectionUpdate', updateMenu);
  editorInstance.off('transaction', updateMenu);
  visible.value = false;
  editorInstance = null;
}

onUnmounted(() => {
  detach();
});

watch(
  () => props.editor,
  (ed) => {
    detach();
    if (ed) attach(ed);
  },
  { immediate: true },
);

defineExpose({ attach, detach, updateMenu });
</script>

<style scoped>
.table-bubble-menu {
  position: absolute;
  z-index: 50;
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--hn-bg-elevated, #2a2a2a);
  border: 1px solid var(--hn-border, #444);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.table-bubble-menu button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--hn-text, #e0e0e0);
  cursor: pointer;
}

.table-bubble-menu button:hover {
  background: var(--hn-bg-hover, #3a3a3a);
}

.table-bubble-menu button.danger:hover {
  background: rgba(220, 53, 69, 0.25);
  color: #ff6b6b;
}

.table-bubble-menu ion-icon {
  font-size: 16px;
}
</style>

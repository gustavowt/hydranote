<template>
  <Teleport to="body">
    <div
      v-if="isVisible && commands.length > 0"
      class="slash-menu"
      :style="positionStyle"
      ref="menuRef"
    >
      <div class="slash-menu-header">
        <ion-icon :icon="flashOutline" />
        <span>Insert block</span>
      </div>
      <div class="slash-menu-list" ref="listRef">
        <div
          v-for="(cmd, index) in commands"
          :key="cmd.id"
          class="slash-menu-item"
          :class="{ selected: index === selectedIndex }"
          :data-slash-index="index"
          @click="selectCommand(cmd)"
          @mouseenter="selectedIndex = index"
        >
          <span class="slash-menu-label">{{ cmd.label }}</span>
          <span class="slash-menu-desc">{{ cmd.description }}</span>
        </div>
      </div>
      <div class="slash-menu-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> insert</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { IonIcon } from '@ionic/vue';
import { flashOutline } from 'ionicons/icons';
import type { SlashCommand } from '@/composables/markdownSlashCommands';

const props = defineProps<{
  commands: SlashCommand[];
  isVisible: boolean;
  anchorRect?: DOMRect | null;
}>();

const emit = defineEmits<{
  (e: 'select', command: SlashCommand): void;
  (e: 'close'): void;
}>();

const selectedIndex = ref(0);
const menuRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

/** Fallback when menu is not yet measured: header + list (240) + footer */
const MENU_MAX_HEIGHT = 320;
const MENU_MAX_WIDTH = 320;
const VIEWPORT_PAD = 8;

const positionStyle = ref<Record<string, string | number>>({ display: 'none' });

function computePosition(): void {
  if (!props.anchorRect || !props.isVisible) {
    positionStyle.value = { display: 'none' };
    return;
  }

  const measuredHeight = menuRef.value?.offsetHeight || MENU_MAX_HEIGHT;
  const measuredWidth = menuRef.value?.offsetWidth || MENU_MAX_WIDTH;
  const spaceBelow = window.innerHeight - props.anchorRect.bottom - VIEWPORT_PAD;
  const spaceAbove = props.anchorRect.top - VIEWPORT_PAD;
  const placeAbove =
    spaceBelow < measuredHeight && spaceAbove > spaceBelow;

  let top = placeAbove
    ? props.anchorRect.top - measuredHeight - 4
    : props.anchorRect.bottom + 4;
  top = Math.max(
    VIEWPORT_PAD,
    Math.min(top, window.innerHeight - measuredHeight - VIEWPORT_PAD),
  );

  let left = Math.max(VIEWPORT_PAD, props.anchorRect.left);
  if (left + measuredWidth > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, window.innerWidth - measuredWidth - VIEWPORT_PAD);
  }

  positionStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    maxWidth: `${MENU_MAX_WIDTH}px`,
    zIndex: 10000,
  };
}

async function updatePosition(): Promise<void> {
  // First pass with estimate so the menu mounts on-screen
  computePosition();
  await nextTick();
  // Second pass with measured size for accurate flip/clamp
  computePosition();
}

watch(
  () => props.commands,
  () => {
    selectedIndex.value = 0;
  },
);

watch(
  () => [props.isVisible, props.anchorRect, props.commands.length] as const,
  ([visible]) => {
    if (visible) {
      selectedIndex.value = 0;
      void updatePosition();
    } else {
      positionStyle.value = { display: 'none' };
    }
  },
  { immediate: true },
);

function selectCommand(cmd: SlashCommand) {
  emit('select', cmd);
}

function scrollSelectedIntoView() {
  void nextTick(() => {
    const list = listRef.value;
    if (!list) return;
    const item = list.querySelector(
      `[data-slash-index="${selectedIndex.value}"]`,
    ) as HTMLElement | null;
    item?.scrollIntoView({ block: 'nearest' });
  });
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.isVisible || props.commands.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % props.commands.length;
    scrollSelectedIntoView();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + props.commands.length) % props.commands.length;
    scrollSelectedIntoView();
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    const cmd = props.commands[selectedIndex.value];
    if (cmd) emit('select', cmd);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown, true);
});
</script>

<style scoped>
.slash-menu {
  background: var(--hn-bg-elevated, #1e1e2e);
  border: 1px solid var(--hn-border-default, #333);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-size: 0.85rem;
}

.slash-menu-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  color: var(--hn-text-secondary, #888);
  border-bottom: 1px solid var(--hn-border-default, #333);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.slash-menu-list {
  max-height: 240px;
  overflow-y: auto;
}

.slash-menu-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  cursor: pointer;
}

.slash-menu-item:hover,
.slash-menu-item.selected {
  background: var(--hn-bg-hover, rgba(255, 255, 255, 0.06));
}

.slash-menu-label {
  font-weight: 500;
  color: var(--hn-text-primary, #eee);
}

.slash-menu-desc {
  font-size: 0.75rem;
  color: var(--hn-text-secondary, #888);
}

.slash-menu-footer {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--hn-border-default, #333);
  font-size: 0.7rem;
  color: var(--hn-text-secondary, #888);
}

.slash-menu-footer kbd {
  background: var(--hn-bg-surface, #2a2a3e);
  border: 1px solid var(--hn-border-default, #444);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: inherit;
  font-size: 0.65rem;
}
</style>

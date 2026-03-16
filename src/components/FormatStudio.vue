<template>
  <ion-modal :is-open="isOpen" @didDismiss="handleDismiss" class="format-studio-modal">
    <ion-header>
      <ion-toolbar>
        <ion-title>Format Studio</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="handleDismiss">
            <ion-icon :icon="closeOutline" slot="icon-only" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding format-studio-content">
      <!-- Processing animation -->
      <div v-if="processing" class="processing-state">
        <div class="processing-icon">
          <ion-icon :icon="sparklesOutline" class="sparkle-icon" />
        </div>
        <p class="processing-label">{{ versions.length === 0 ? 'Formatting your note...' : 'Refining...' }}</p>
        <div class="skeleton-lines">
          <div class="skeleton-line" style="width: 85%"></div>
          <div class="skeleton-line" style="width: 70%"></div>
          <div class="skeleton-line" style="width: 92%"></div>
          <div class="skeleton-line short" style="width: 40%"></div>
          <div class="skeleton-line" style="width: 78%"></div>
          <div class="skeleton-line" style="width: 88%"></div>
          <div class="skeleton-line" style="width: 60%"></div>
        </div>
      </div>

      <!-- Initial state: no versions yet -->
      <div v-else-if="versions.length === 0" class="initial-state">
        <p class="format-description">
          AI will format and improve your note's structure. Add any specific instructions below (optional):
        </p>
        <p class="format-hint">
          <ion-icon :icon="informationCircleOutline" />
          Your default formatting settings from Settings will also be applied.
        </p>
      </div>

      <!-- Version preview: show rendered markdown -->
      <div v-else class="version-preview-area">
        <div class="version-nav-bar">
          <ion-button
            fill="clear"
            size="small"
            :disabled="currentVersionIndex <= 0"
            @click="currentVersionIndex--"
            class="nav-btn"
          >
            <ion-icon :icon="chevronBackOutline" slot="icon-only" />
          </ion-button>
          <span class="version-indicator">
            Version {{ currentVersionIndex + 1 }} of {{ versions.length }}
          </span>
          <ion-button
            fill="clear"
            size="small"
            :disabled="currentVersionIndex >= versions.length - 1"
            @click="currentVersionIndex++"
            class="nav-btn"
          >
            <ion-icon :icon="chevronForwardOutline" slot="icon-only" />
          </ion-button>
        </div>
        <div class="preview-scroll">
          <div class="markdown-preview" v-html="renderedPreview"></div>
        </div>
      </div>
    </ion-content>

    <ion-footer class="format-studio-footer">
      <div class="prompt-area">
        <textarea
          ref="promptRef"
          v-model="promptInput"
          :placeholder="promptPlaceholder"
          :disabled="processing"
          rows="2"
          class="prompt-input"
          @keydown.enter.meta.exact="handleFormat"
          @keydown.enter.ctrl.exact="handleFormat"
        ></textarea>
      </div>
      <div class="action-bar">
        <ion-button fill="clear" @click="handleDismiss" :disabled="processing" class="cancel-btn">
          Cancel
        </ion-button>
        <div class="action-right">
          <ion-button
            v-if="versions.length > 0"
            fill="solid"
            :disabled="processing"
            @click="handleApply"
            class="apply-btn"
          >
            Apply
          </ion-button>
          <ion-button
            fill="solid"
            :strong="true"
            :disabled="processing || !promptInput.trim()"
            @click="handleFormat"
            class="format-btn"
          >
            <ion-spinner v-if="processing" name="dots" class="btn-spinner" />
            <span v-else>{{ versions.length === 0 ? 'Format' : 'Refine' }}</span>
          </ion-button>
        </div>
      </div>
    </ion-footer>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import {
  IonModal,
  IonHeader,
  IonFooter,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonSpinner,
  toastController,
} from '@ionic/vue';
import {
  closeOutline,
  informationCircleOutline,
  chevronBackOutline,
  chevronForwardOutline,
  sparklesOutline,
} from 'ionicons/icons';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import mermaid from 'mermaid';
import type { LLMMessage, ProjectFile, FormatSessionVersion } from '@/types';
import {
  formatNoteWithConversation,
  buildFormatNotePrompt,
  getNoteFormatInstructions,
} from '@/services';

interface Props {
  isOpen: boolean;
  noteContent: string;
  currentFile?: ProjectFile | null;
}

const props = withDefaults(defineProps<Props>(), {
  currentFile: null,
});

const emit = defineEmits<{
  (e: 'dismiss'): void;
  (e: 'apply', content: string): void;
}>();

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'inherit',
});

const mermaidRenderer = {
  code(token: { text: string; lang?: string }): string | false {
    if (token.lang === 'mermaid') {
      const id = `mermaid-fs-${Math.random().toString(36).substring(2, 9)}`;
      const encodedCode = btoa(encodeURIComponent(token.text));
      return `<div class="mermaid-diagram" data-mermaid-id="${id}" data-mermaid-code="${encodedCode}"></div>`;
    }
    return false;
  }
};

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang === 'mermaid') return code;
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch { /* fall through */ }
      }
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return code;
      }
    },
  })
);
marked.use({ renderer: mermaidRenderer });

const versions = ref<FormatSessionVersion[]>([]);
const currentVersionIndex = ref(0);
const conversation = ref<LLMMessage[]>([]);
const promptInput = ref('');
const processing = ref(false);
const promptRef = ref<HTMLTextAreaElement | null>(null);

const promptPlaceholder = computed(() =>
  versions.value.length === 0
    ? "E.g., 'Use bullet points for lists', 'Add a summary section', 'Convert to formal tone'..."
    : "Describe what to change, e.g. 'Make the headings shorter', 'Add a TL;DR section'..."
);

const renderedPreview = computed(() => {
  if (versions.value.length === 0) return '';
  const content = versions.value[currentVersionIndex.value]?.content ?? '';
  if (!content.trim()) return '<p class="placeholder-text">No content</p>';
  return marked.parse(content, { async: false }) as string;
});

async function renderMermaidDiagrams() {
  await nextTick();
  const containers = document.querySelectorAll('.format-studio-modal .mermaid-diagram[data-mermaid-code]');
  for (const container of Array.from(containers)) {
    if (container.getAttribute('data-rendered')) continue;
    const encodedCode = container.getAttribute('data-mermaid-code');
    if (!encodedCode) continue;
    try {
      const code = decodeURIComponent(atob(encodedCode));
      const id = container.getAttribute('data-mermaid-id') || `mermaid-fs-${Math.random().toString(36).substring(2, 9)}`;
      const { svg } = await mermaid.render(id, code);
      container.innerHTML = svg;
      container.setAttribute('data-rendered', 'true');
    } catch {
      container.innerHTML = '<p class="mermaid-error">Failed to render diagram</p>';
      container.setAttribute('data-rendered', 'true');
    }
  }
}

watch(renderedPreview, () => {
  renderMermaidDiagrams();
});

function resetSession() {
  versions.value = [];
  currentVersionIndex.value = 0;
  conversation.value = [];
  promptInput.value = '';
  processing.value = false;
}

watch(() => props.isOpen, (open) => {
  if (open) {
    resetSession();
    nextTick(() => promptRef.value?.focus());
  }
});

function handleDismiss() {
  if (processing.value) return;
  resetSession();
  emit('dismiss');
}

async function handleFormat() {
  if (processing.value || !promptInput.value.trim()) return;

  const isFirstRound = versions.value.length === 0;

  if (isFirstRound && !props.noteContent.trim()) {
    const toast = await toastController.create({
      message: 'No content to format',
      duration: 2000,
      position: 'top',
      color: 'warning',
    });
    await toast.present();
    return;
  }

  processing.value = true;

  try {
    if (isFirstRound) {
      const settingsInstructions = getNoteFormatInstructions();
      let combinedInstructions = settingsInstructions;

      if (promptInput.value.trim()) {
        combinedInstructions = combinedInstructions
          ? `${settingsInstructions}\n\nAdditional instructions:\n${promptInput.value.trim()}`
          : promptInput.value.trim();
      }

      const systemPrompt = buildFormatNotePrompt(combinedInstructions);

      conversation.value = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: props.noteContent },
      ];
    } else {
      const instruction = promptInput.value.trim() || 'Please refine the formatting further.';
      conversation.value.push({ role: 'user', content: instruction });
    }

    const result = await formatNoteWithConversation([...conversation.value]);

    conversation.value.push({ role: 'assistant', content: result });

    versions.value.push({
      content: result,
      instruction: promptInput.value.trim() || (isFirstRound ? '(initial format)' : '(refine)'),
      createdAt: new Date(),
    });

    currentVersionIndex.value = versions.value.length - 1;
    promptInput.value = '';

    await nextTick();
    promptRef.value?.focus();
  } catch {
    const toast = await toastController.create({
      message: 'Failed to format note. Please try again.',
      duration: 3000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();

    if (versions.value.length === 0) {
      conversation.value = [];
    } else {
      conversation.value.pop();
    }
  } finally {
    processing.value = false;
  }
}

function handleApply() {
  if (processing.value || versions.value.length === 0) return;
  const selectedContent = versions.value[currentVersionIndex.value].content;
  emit('apply', selectedContent);
  resetSession();
}
</script>

<style scoped>
.format-studio-modal {
  --width: 90%;
  --max-width: 900px;
  --height: 85%;
  --border-radius: 12px;
}

ion-content.format-studio-content {
  --background: var(--hn-bg-deep);
}

.initial-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
  text-align: center;
}

.format-description {
  color: var(--hn-text-secondary);
  font-size: 1rem;
  line-height: 1.6;
  max-width: 480px;
}

.format-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--hn-text-muted);
  font-size: 0.8rem;
  padding: 10px 14px;
  background: var(--hn-bg-surface);
  border-radius: 6px;
  margin-top: 20px;
}

.format-hint ion-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--hn-teal);
}

/* Processing animation */
.processing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
  gap: 20px;
}

.processing-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(45, 212, 191, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: processingPulse 2s ease-in-out infinite;
}

.sparkle-icon {
  font-size: 28px;
  color: var(--hn-teal);
  animation: sparkleRotate 3s linear infinite;
}

.processing-label {
  color: var(--hn-text-secondary);
  font-size: 0.95rem;
  font-weight: 500;
  margin: 0;
}

.skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 520px;
  margin-top: 8px;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--hn-bg-surface) 25%,
    var(--hn-bg-elevated) 50%,
    var(--hn-bg-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

.skeleton-line:nth-child(1) { animation-delay: 0s; }
.skeleton-line:nth-child(2) { animation-delay: 0.1s; }
.skeleton-line:nth-child(3) { animation-delay: 0.2s; }
.skeleton-line:nth-child(4) { animation-delay: 0.3s; }
.skeleton-line:nth-child(5) { animation-delay: 0.4s; }
.skeleton-line:nth-child(6) { animation-delay: 0.5s; }
.skeleton-line:nth-child(7) { animation-delay: 0.6s; }

.skeleton-line.short {
  height: 12px;
  margin-top: 8px;
  margin-bottom: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes processingPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
}

@keyframes sparkleRotate {
  0% { transform: rotate(0deg) scale(1); }
  25% { transform: rotate(5deg) scale(1.1); }
  50% { transform: rotate(0deg) scale(1); }
  75% { transform: rotate(-5deg) scale(1.1); }
  100% { transform: rotate(0deg) scale(1); }
}

/* Version preview area */
.version-preview-area {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.version-nav-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 0 10px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--hn-border-default);
  margin-bottom: 12px;
}

.version-indicator {
  color: var(--hn-text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  min-width: 120px;
  text-align: center;
}

.nav-btn {
  --color: var(--hn-text-secondary);
  --padding-start: 6px;
  --padding-end: 6px;
}

.nav-btn:hover {
  --color: var(--hn-teal);
}

.preview-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 0 4px 16px;
}

/* Reuse the same markdown preview styling as MarkdownEditor */
.markdown-preview {
  color: var(--hn-text-primary);
  line-height: 1.7;
}

.markdown-preview :deep(.placeholder-text) {
  color: var(--hn-text-muted);
  font-style: italic;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  color: #ffffff;
  font-weight: 600;
  margin: 1.5em 0 0.6em;
  line-height: 1.3;
}

.markdown-preview :deep(h1) {
  font-size: 2em;
  border-bottom: 1px solid var(--hn-border-default);
  padding-bottom: 0.3em;
}

.markdown-preview :deep(h2) {
  font-size: 1.5em;
  border-bottom: 1px solid var(--hn-border-default);
  padding-bottom: 0.3em;
}

.markdown-preview :deep(h3) { font-size: 1.25em; }
.markdown-preview :deep(h4) { font-size: 1em; }

.markdown-preview :deep(p) { margin: 1em 0; }

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 1em 0;
  padding-left: 2em;
}

.markdown-preview :deep(li) { margin: 0.4em 0; }

.markdown-preview :deep(code) {
  background: var(--hn-bg-elevated);
  padding: 0.2em 0.5em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  background: var(--hn-bg-surface);
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1.2em 0;
}

.markdown-preview :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.6;
  color: var(--hn-text-primary);
}

.markdown-preview :deep(blockquote) {
  border-left: 4px solid var(--hn-teal);
  margin: 1.2em 0;
  padding: 0.6em 0 0.6em 1.2em;
  color: var(--hn-text-secondary);
  background: var(--hn-teal-muted);
}

.markdown-preview :deep(a) {
  color: var(--hn-purple);
  text-decoration: none;
}

.markdown-preview :deep(a:hover) { text-decoration: underline; }

.markdown-preview :deep(strong) {
  font-weight: 600;
  color: #ffffff;
}

.markdown-preview :deep(em) {
  font-style: italic;
  color: var(--hn-text-primary);
}

.markdown-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--hn-border-default);
  margin: 2em 0;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1.2em 0;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--hn-border-default);
  padding: 10px 14px;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: var(--hn-bg-surface);
  font-weight: 600;
  color: #ffffff;
}

.markdown-preview :deep(tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.02);
}

.markdown-preview :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
}

.markdown-preview :deep(.mermaid-diagram) {
  margin: 1.5em 0;
  padding: 16px;
  background: var(--hn-bg-surface);
  border-radius: 8px;
  border: 1px solid var(--hn-border-default);
}

.markdown-preview :deep(.mermaid-diagram svg) {
  max-width: 100%;
  height: auto;
}

.markdown-preview :deep(.mermaid-error) {
  color: var(--hn-error, #ef4444);
  font-style: italic;
  padding: 12px;
  text-align: center;
}

/* Footer with prompt + actions */
.format-studio-footer {
  border-top: 1px solid var(--hn-border-default);
  background: var(--hn-bg-surface);
}

.format-studio-footer ion-toolbar {
  display: none;
}

.prompt-area {
  padding: 12px 16px 0;
}

.prompt-input {
  width: 100%;
  background: var(--hn-bg-deep);
  color: var(--hn-text-primary);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  outline: none;
  box-sizing: border-box;
}

.prompt-input::placeholder {
  color: var(--hn-text-muted);
}

.prompt-input:focus {
  border-color: var(--hn-teal);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.15);
}

.prompt-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 12px;
}

.action-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cancel-btn {
  --color: var(--hn-text-secondary);
}

.cancel-btn:hover {
  --color: var(--hn-text-primary);
}

.apply-btn {
  --background: var(--hn-green);
  --color: #ffffff;
  --border-radius: 8px;
  --padding-start: 18px;
  --padding-end: 18px;
}

.format-btn {
  --background: linear-gradient(135deg, var(--hn-green) 0%, var(--hn-teal) 100%);
  --color: #ffffff;
  --border-radius: 8px;
  --padding-start: 18px;
  --padding-end: 18px;
  min-width: 90px;
}

.format-btn:disabled {
  opacity: 0.5;
}

.btn-spinner {
  width: 20px;
  height: 20px;
}
</style>

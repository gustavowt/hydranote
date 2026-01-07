<template>
  <div class="pdf-viewer-container">
    <!-- Viewer Header -->
    <div class="viewer-header">
      <div class="header-left">
        <ion-icon :icon="documentOutline" class="header-icon" />
        <span class="header-title" :title="fileName">
          {{ fileName }}
        </span>
      </div>
      <div class="header-actions">
        <!-- Page Navigation -->
        <div class="page-nav" v-if="totalPages > 0">
          <button 
            class="nav-btn"
            :disabled="currentPage <= 1"
            @click="goToPage(currentPage - 1)"
            title="Previous Page"
          >
            <ion-icon :icon="chevronBackOutline" />
          </button>
          <span class="page-indicator">
            <input
              type="number"
              v-model.number="pageInput"
              :min="1"
              :max="totalPages"
              @keydown.enter="goToPage(pageInput)"
              @blur="goToPage(pageInput)"
              class="page-input"
            />
            <span class="page-total">/ {{ totalPages }}</span>
          </span>
          <button 
            class="nav-btn"
            :disabled="currentPage >= totalPages"
            @click="goToPage(currentPage + 1)"
            title="Next Page"
          >
            <ion-icon :icon="chevronForwardOutline" />
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <!-- Zoom Controls -->
        <div class="zoom-controls">
          <button 
            class="nav-btn"
            @click="zoomOut"
            :disabled="scale <= 0.5"
            title="Zoom Out"
          >
            <ion-icon :icon="removeOutline" />
          </button>
          <span class="zoom-indicator">{{ Math.round(scale * 100) }}%</span>
          <button 
            class="nav-btn"
            @click="zoomIn"
            :disabled="scale >= 3"
            title="Zoom In"
          >
            <ion-icon :icon="addOutline" />
          </button>
          <button 
            class="nav-btn"
            @click="fitToWidth"
            title="Fit to Width"
          >
            <ion-icon :icon="expandOutline" />
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <!-- Open in System -->
        <button 
          v-if="props.systemFilePath"
          class="nav-btn open-system-btn"
          @click="openInSystem"
          title="Open in System"
        >
          <ion-icon :icon="openOutline" />
        </button>
      </div>
    </div>

    <!-- PDF Content -->
    <div class="pdf-content" ref="pdfContainer">
      <!-- Loading State -->
      <div v-if="loading" class="loading-state">
        <ion-spinner name="crescent" />
        <p>Loading PDF...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="error-state">
        <ion-icon :icon="alertCircleOutline" class="error-icon" />
        <p>{{ error }}</p>
        <ion-button fill="outline" size="small" @click="loadPDF">
          Try Again
        </ion-button>
      </div>

      <!-- PDF Pages -->
      <div v-else class="pdf-pages" ref="pagesContainer">
        <canvas
          v-for="page in renderedPages"
          :key="page"
          :ref="(el) => setCanvasRef(page, el as HTMLCanvasElement)"
          class="pdf-page"
          :class="{ 'current-page': page === currentPage }"
        ></canvas>
      </div>
    </div>

    <!-- Status Bar -->
    <div class="status-bar">
      <span class="status-item">
        <ion-icon :icon="documentsOutline" />
        {{ totalPages }} pages
      </span>
      <span class="status-item file-type">
        <ion-icon :icon="documentAttachOutline" />
        PDF
      </span>
      <span v-if="currentProject" class="status-item project-tag">
        <ion-icon :icon="folderOutline" />
        {{ currentProject.name }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  IonIcon,
  IonButton,
  IonSpinner,
} from '@ionic/vue';
import {
  documentOutline,
  documentsOutline,
  documentAttachOutline,
  folderOutline,
  chevronBackOutline,
  chevronForwardOutline,
  removeOutline,
  addOutline,
  expandOutline,
  openOutline,
  alertCircleOutline,
} from 'ionicons/icons';
import type { Project, ProjectFile } from '@/types';
import { isElectron, getElectronAPI } from '@/services/fileSystemService';

// Configure PDF.js worker
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

interface Props {
  currentFile?: ProjectFile | null;
  currentProject?: Project | null;
  /** System file path for loading PDF from file system (preferred) */
  systemFilePath?: string | null;
  /** PDF data for legacy/fallback loading */
  pdfData?: ArrayBuffer | Uint8Array | null;
}

const props = withDefaults(defineProps<Props>(), {
  currentFile: null,
  currentProject: null,
  systemFilePath: null,
  pdfData: null,
});

const pdfContainer = ref<HTMLDivElement | null>(null);
const pagesContainer = ref<HTMLDivElement | null>(null);
const canvasRefs = ref<Map<number, HTMLCanvasElement>>(new Map());

const loading = ref(false);
const error = ref<string | null>(null);
// Use shallowRef to prevent Vue from making pdfDoc reactive (causes issues with pdf.js private fields)
const pdfDoc = shallowRef<PDFDocumentProxy | null>(null);
const totalPages = ref(0);
const currentPage = ref(1);
const pageInput = ref(1);
const scale = ref(1.0);
const renderedPages = ref<number[]>([]);

const fileName = computed(() => {
  if (!props.currentFile) return 'PDF Document';
  return props.currentFile.name || 'Untitled.pdf';
});

function setCanvasRef(page: number, el: HTMLCanvasElement | null) {
  if (el) {
    canvasRefs.value.set(page, el);
  } else {
    canvasRefs.value.delete(page);
  }
}

async function loadPDF() {
  loading.value = true;
  error.value = null;

  try {
    let pdfDataToLoad: ArrayBuffer | Uint8Array | null = null;
    
    // Try to load from system file path first (Electron only)
    if (props.systemFilePath && isElectron()) {
      const electronAPI = getElectronAPI();
      if (electronAPI) {
        const result = await electronAPI.fs.readBinaryFile(props.systemFilePath);
        if (result.success && result.data) {
          // Convert base64 string to ArrayBuffer
          const binaryString = atob(result.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          pdfDataToLoad = bytes;
        } else {
          error.value = result.error || 'Failed to load PDF from file system';
          loading.value = false;
          return;
        }
      }
    } else if (props.pdfData) {
      // Fallback to provided pdfData (legacy support)
      pdfDataToLoad = props.pdfData;
    }
    
    if (!pdfDataToLoad) {
      error.value = 'No PDF data available. The file may have been moved or deleted.';
      loading.value = false;
      return;
    }

    const loadingTask = pdfjsLib.getDocument({ data: pdfDataToLoad });
    pdfDoc.value = await loadingTask.promise;
    totalPages.value = pdfDoc.value.numPages;
    currentPage.value = 1;
    pageInput.value = 1;
    
    // Render all pages (or use virtual scrolling for large documents)
    renderedPages.value = Array.from({ length: totalPages.value }, (_, i) => i + 1);
    
    // Wait for Vue to create canvas elements in the DOM
    await nextTick();
    
    // Auto fit-to-width: calculate scale before rendering
    let initialScale = 1.0;
    if (pdfContainer.value && pdfDoc.value) {
      const containerWidth = pdfContainer.value.clientWidth - 48; // Account for padding
      const firstPage = await pdfDoc.value.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      initialScale = containerWidth / viewport.width;
    }
    scale.value = initialScale;
    
    // Set loading to false BEFORE rendering so the canvas elements exist in the DOM
    // (they're inside a v-else block that only renders when loading is false)
    loading.value = false;
    
    // Wait for Vue to create the canvas elements now that loading is false
    await nextTick();
    
    await renderAllPages();
  } catch (err) {
    console.error('Failed to load PDF:', err);
    error.value = 'Failed to load PDF. The file may be corrupted or password-protected.';
    loading.value = false;
  }
}

async function renderAllPages() {
  if (!pdfDoc.value) return;

  for (let pageNum = 1; pageNum <= totalPages.value; pageNum++) {
    await renderPage(pageNum);
  }
}

async function renderPage(pageNum: number) {
  if (!pdfDoc.value) return;

  const canvas = canvasRefs.value.get(pageNum);
  if (!canvas) return;

  try {
    const page = await pdfDoc.value.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale.value });

    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    }).promise;
  } catch (err) {
    console.error(`Failed to render page ${pageNum}:`, err);
  }
}

function goToPage(page: number) {
  const targetPage = Math.max(1, Math.min(page, totalPages.value));
  currentPage.value = targetPage;
  pageInput.value = targetPage;

  // Scroll to the page
  const canvas = canvasRefs.value.get(targetPage);
  if (canvas && pagesContainer.value) {
    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function zoomIn() {
  if (scale.value < 3) {
    scale.value = Math.min(3, scale.value + 0.25);
    reRenderPages();
  }
}

function zoomOut() {
  if (scale.value > 0.5) {
    scale.value = Math.max(0.5, scale.value - 0.25);
    reRenderPages();
  }
}

function fitToWidth() {
  if (!pdfContainer.value || !pdfDoc.value) return;

  // Get container width and calculate scale to fit
  const containerWidth = pdfContainer.value.clientWidth - 48; // Account for padding
  
  pdfDoc.value.getPage(1).then(page => {
    const viewport = page.getViewport({ scale: 1 });
    scale.value = containerWidth / viewport.width;
    reRenderPages();
  });
}

async function reRenderPages() {
  await nextTick();
  await renderAllPages();
}

/**
 * Open the PDF in the system's default PDF viewer
 */
async function openInSystem() {
  if (!props.systemFilePath) return;
  
  if (isElectron()) {
    const electronAPI = getElectronAPI();
    if (electronAPI && electronAPI.shell) {
      // Use Electron's shell.openPath to open in default application
      await electronAPI.shell.openPath(props.systemFilePath);
    }
  }
}

// Handle scroll to track current page
function handleScroll() {
  if (!pagesContainer.value) return;

  const containerRect = pagesContainer.value.getBoundingClientRect();
  const containerTop = containerRect.top;

  for (const [pageNum, canvas] of canvasRefs.value) {
    const rect = canvas.getBoundingClientRect();
    if (rect.top <= containerTop + 100 && rect.bottom > containerTop) {
      if (currentPage.value !== pageNum) {
        currentPage.value = pageNum;
        pageInput.value = pageNum;
      }
      break;
    }
  }
}

// Watch for PDF data or system file path changes
watch(
  [() => props.systemFilePath, () => props.pdfData],
  ([newPath, newData]) => {
    if (newPath || newData) {
      loadPDF();
    }
  },
  { immediate: true }
);

// Watch for scale changes
watch(scale, () => {
  reRenderPages();
});

onMounted(() => {
  if (pagesContainer.value) {
    pagesContainer.value.addEventListener('scroll', handleScroll);
  }
});

onBeforeUnmount(() => {
  if (pagesContainer.value) {
    pagesContainer.value.removeEventListener('scroll', handleScroll);
  }
  pdfDoc.value?.destroy();
});

// Expose methods
function setPDFData(data: ArrayBuffer | Uint8Array) {
  // This will trigger the watcher
}

defineExpose({ setPDFData, goToPage });
</script>

<style scoped>
.pdf-viewer-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--hn-bg-deepest);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* Viewer Header */
.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--hn-bg-surface);
  border-bottom: 1px solid var(--hn-border-default);
  min-height: 48px;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-icon {
  font-size: 18px;
  color: var(--hn-orange);
  flex-shrink: 0;
}

.header-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Page Navigation */
.page-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: var(--hn-bg-elevated);
  border-radius: 4px;
  cursor: pointer;
  color: var(--hn-text-secondary);
  transition: all 0.15s ease;
}

.nav-btn:hover:not(:disabled) {
  color: var(--hn-text-primary);
  background: var(--hn-bg-hover);
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-btn ion-icon {
  font-size: 16px;
}

.page-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.page-input {
  width: 40px;
  padding: 4px 6px;
  text-align: center;
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 4px;
  color: var(--hn-text-primary);
  font-size: 0.85rem;
}

.page-input:focus {
  outline: none;
  border-color: var(--hn-teal);
}

.page-total {
  color: var(--hn-text-muted);
}

/* Zoom Controls */
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.zoom-indicator {
  min-width: 48px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--hn-text-secondary);
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--hn-border-default);
  margin: 0 8px;
}

.download-btn {
  color: var(--hn-green) !important;
}

.download-btn:hover {
  background: rgba(63, 185, 80, 0.15) !important;
}

/* PDF Content */
.pdf-content {
  flex: 1;
  overflow: auto;
  background: var(--hn-bg-deepest);
  display: flex;
  justify-content: center;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--hn-text-secondary);
  text-align: center;
}

.loading-state ion-spinner {
  --color: var(--hn-teal);
  width: 36px;
  height: 36px;
  margin-bottom: 12px;
}

.error-state .error-icon {
  font-size: 48px;
  color: var(--hn-error);
  margin-bottom: 12px;
}

.error-state ion-button {
  margin-top: 16px;
}

/* PDF Pages */
.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
}

.pdf-page {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  background: #ffffff;
  border-radius: 2px;
}

.pdf-page.current-page {
  box-shadow: 0 4px 20px rgba(45, 212, 191, 0.3), 0 0 0 2px var(--hn-teal);
}

/* Status Bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 16px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
  font-size: 0.75rem;
  color: var(--hn-text-secondary);
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-item ion-icon {
  font-size: 12px;
}

.status-item.file-type {
  color: var(--hn-orange);
}

.status-item.project-tag {
  margin-left: auto;
  color: var(--hn-teal);
}

/* Scrollbar */
.pdf-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.pdf-content::-webkit-scrollbar-track {
  background: transparent;
}

.pdf-content::-webkit-scrollbar-thumb {
  background: var(--hn-border-default);
  border-radius: 4px;
}

.pdf-content::-webkit-scrollbar-thumb:hover {
  background: var(--hn-border-strong);
}
</style>


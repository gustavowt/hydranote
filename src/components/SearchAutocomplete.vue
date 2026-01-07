<template>
  <div class="search-autocomplete" ref="containerRef">
    <div class="search-input-wrapper">
      <ion-icon :icon="searchOutline" class="search-icon" />
      <input
        ref="inputRef"
        v-model="searchQuery"
        type="text"
        placeholder="Search files..."
        class="search-input"
        @input="handleInput"
        @keydown="handleKeydown"
        @focus="handleFocus"
        @blur="handleBlur"
      />
      <ion-icon
        v-if="searchQuery"
        :icon="closeCircleOutline"
        class="clear-icon"
        @click="clearSearch"
      />
    </div>

    <!-- Dropdown Results -->
    <Teleport to="body">
      <div
        v-if="showDropdown && (filteredResults.length > 0 || isLoading)"
        class="search-dropdown"
        :style="dropdownStyle"
      >
        <div v-if="isLoading" class="search-loading">
          <ion-spinner name="crescent" />
          <span>Loading...</span>
        </div>

        <template v-else>
          <!-- Projects Section -->
          <template v-if="filteredProjects.length > 0">
            <div class="section-header">
              <span class="section-title">Projects</span>
              <span class="section-count">{{ filteredProjects.length }}</span>
            </div>
            <div
              v-for="(item, index) in filteredProjects"
              :key="'project-' + item.id"
              class="search-result-item is-project"
              :class="{ 'is-selected': index === selectedIndex }"
              @click="selectProject(item)"
              @mouseenter="selectedIndex = index"
            >
              <div class="result-icon project-icon">
                <ion-icon :icon="folderOutline" />
              </div>
              <div class="result-content">
                <div
                  class="result-name"
                  v-html="highlightMatch(item.name, searchQuery)"
                />
                <div v-if="item.description" class="result-meta">
                  {{ item.description }}
                </div>
              </div>
            </div>
          </template>

          <!-- Files Section -->
          <template v-if="filteredFiles.length > 0">
            <div
              class="section-header"
              :class="{ 'has-top-border': filteredProjects.length > 0 }"
            >
              <span class="section-title">Files</span>
              <span class="section-count">{{ filteredFiles.length }}</span>
            </div>
            <div
              v-for="(item, index) in filteredFiles"
              :key="'file-' + item.id"
              class="search-result-item"
              :class="{
                'is-selected':
                  index + filteredProjects.length === selectedIndex,
              }"
              @click="selectFile(item)"
              @mouseenter="selectedIndex = index + filteredProjects.length"
            >
              <div
                class="result-icon"
                :style="{ color: getFileIconColor(item.type) }"
              >
                <ion-icon :icon="getFileIcon(item.type)" />
              </div>
              <div class="result-content">
                <div
                  class="result-name"
                  v-html="highlightMatch(item.name, searchQuery)"
                />
                <div class="result-meta">
                  <span class="result-project">{{ item.projectName }}</span>
                  <span v-if="item.path !== item.name" class="result-path"
                    >• {{ item.path }}</span
                  >
                </div>
              </div>
            </div>
          </template>

          <!-- No Results -->
          <div
            v-if="filteredResults.length === 0 && searchQuery.length >= 2"
            class="no-results"
          >
            No files found for "{{ searchQuery }}"
          </div>
        </template>

        <!-- Footer -->
        <div class="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { IonIcon, IonSpinner } from "@ionic/vue";
import {
  searchOutline,
  closeCircleOutline,
  documentTextOutline,
  documentOutline,
  imageOutline,
  folderOutline,
  logoMarkdown,
} from "ionicons/icons";
import { getAllFilesForAutocomplete, getAllProjects } from "@/services";
import type { Project, SupportedFileType } from "@/types";

// Types
interface FileItem {
  id: string;
  name: string;
  path: string;
  type: SupportedFileType;
  projectId: string;
  projectName: string;
}

interface SearchResult {
  item: FileItem | Project;
  type: "file" | "project";
  score: number;
}

// Emits
const emit = defineEmits<{
  (e: "select-file", file: FileItem): void;
  (e: "select-project", project: Project): void;
}>();

// Refs
const containerRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const searchQuery = ref("");
const selectedIndex = ref(0);
const showDropdown = ref(false);
const isLoading = ref(false);
const dropdownRect = ref<DOMRect | null>(null);

// Data stores
const allFiles = ref<FileItem[]>([]);
const allProjects = ref<Project[]>([]);
let dataLoaded = false;

// Fuzzy match scoring function
function fuzzyScore(text: string, query: string): number {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match
  if (textLower === queryLower) return 1.0;

  // Starts with query
  if (textLower.startsWith(queryLower)) return 0.9;

  // Contains query
  if (textLower.includes(queryLower)) return 0.7;

  // Fuzzy character match
  let queryIndex = 0;
  let consecutiveMatches = 0;
  let maxConsecutive = 0;
  let matchCount = 0;

  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      matchCount++;
      consecutiveMatches++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
      queryIndex++;
    } else {
      consecutiveMatches = 0;
    }
  }

  if (queryIndex === queryLower.length) {
    // All query chars found
    const score =
      (matchCount / textLower.length) * 0.3 +
      (maxConsecutive / queryLower.length) * 0.3;
    return Math.min(0.6, score);
  }

  return 0;
}

// Filtered results
const filteredProjects = computed(() => {
  if (!searchQuery.value || searchQuery.value.length < 1) return [];

  const query = searchQuery.value.trim();

  return allProjects.value
    .map((project) => ({
      item: project,
      score: Math.max(
        fuzzyScore(project.name, query),
        fuzzyScore(project.description || "", query) * 0.5,
      ),
    }))
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((r) => r.item);
});

const filteredFiles = computed(() => {
  if (!searchQuery.value || searchQuery.value.length < 1) return [];

  const query = searchQuery.value.trim();

  return allFiles.value
    .map((file) => ({
      item: file,
      score: Math.max(
        fuzzyScore(file.name, query),
        fuzzyScore(file.path, query) * 0.8,
        fuzzyScore(file.projectName, query) * 0.3,
      ),
    }))
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => r.item);
});

const filteredResults = computed(() => {
  return [...filteredProjects.value, ...filteredFiles.value];
});

// Dropdown positioning
const dropdownStyle = computed(() => {
  if (!dropdownRect.value) return { display: "none" };

  return {
    position: "fixed" as const,
    top: `${dropdownRect.value.bottom + 4}px`,
    left: `${dropdownRect.value.left}px`,
    width: `${Math.max(dropdownRect.value.width, 360)}px`,
    maxWidth: "450px",
  };
});

// Load data
async function loadData() {
  if (dataLoaded) return;

  isLoading.value = true;
  try {
    const [files, projects] = await Promise.all([
      getAllFilesForAutocomplete(),
      getAllProjects(),
    ]);
    allFiles.value = files;
    allProjects.value = projects;
    dataLoaded = true;
  } catch (error) {
    console.error("Failed to load search data:", error);
  } finally {
    isLoading.value = false;
  }
}

// Handle input
function handleInput() {
  selectedIndex.value = 0;
}

// Keyboard navigation
function handleKeydown(event: KeyboardEvent) {
  if (!showDropdown.value) {
    if (event.key === "Escape") {
      clearSearch();
      inputRef.value?.blur();
    }
    return;
  }

  const totalResults = filteredResults.value.length;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      selectedIndex.value = Math.min(selectedIndex.value + 1, totalResults - 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
      break;
    case "Enter":
      event.preventDefault();
      handleEnterSelect();
      break;
    case "Escape":
      event.preventDefault();
      showDropdown.value = false;
      inputRef.value?.blur();
      break;
  }
}

function handleEnterSelect() {
  const projectsLen = filteredProjects.value.length;

  if (selectedIndex.value < projectsLen) {
    const project = filteredProjects.value[selectedIndex.value];
    if (project) selectProject(project);
  } else {
    const fileIndex = selectedIndex.value - projectsLen;
    const file = filteredFiles.value[fileIndex];
    if (file) selectFile(file);
  }
}

// Focus/blur handlers
async function handleFocus() {
  showDropdown.value = true;
  updateDropdownPosition();
  await loadData();
}

function handleBlur() {
  // Delay to allow click events on results
  setTimeout(() => {
    showDropdown.value = false;
  }, 200);
}

function updateDropdownPosition() {
  if (containerRef.value) {
    dropdownRect.value = containerRef.value.getBoundingClientRect();
  }
}

// Select handlers
function selectFile(file: FileItem) {
  emit("select-file", file);
  clearSearch();
  showDropdown.value = false;
  inputRef.value?.blur();
}

function selectProject(project: Project) {
  emit("select-project", project);
  clearSearch();
  showDropdown.value = false;
  inputRef.value?.blur();
}

// Clear search
function clearSearch() {
  searchQuery.value = "";
  selectedIndex.value = 0;
}

// Get file icon based on type
function getFileIcon(fileType: string): string {
  switch (fileType) {
    case "md":
      return logoMarkdown;
    case "pdf":
      return documentTextOutline;
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
      return imageOutline;
    default:
      return documentOutline;
  }
}

function getFileIconColor(fileType: string): string {
  switch (fileType) {
    case "md":
      return "var(--hn-purple)";
    case "pdf":
      return "var(--hn-danger)";
    case "docx":
      return "var(--hn-green)";
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
      return "var(--hn-purple-light)";
    default:
      return "var(--hn-text-secondary)";
  }
}

// Highlight matching text
function highlightMatch(text: string, query: string): string {
  if (!query) return text;

  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  return text.replace(regex, "<mark>$1</mark>");
}

// Escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Click outside handler
function handleClickOutside(event: MouseEvent) {
  if (
    containerRef.value &&
    !containerRef.value.contains(event.target as Node)
  ) {
    showDropdown.value = false;
  }
}

// Refresh data (can be called when files change)
async function refresh() {
  dataLoaded = false;
  await loadData();
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
  window.addEventListener("resize", updateDropdownPosition);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
  window.removeEventListener("resize", updateDropdownPosition);
});

// Expose methods
defineExpose({
  focus: () => inputRef.value?.focus(),
  refresh,
});
</script>

<style scoped>
.search-autocomplete {
  position: relative;
  width: 100%;
  max-width: 400px;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--hn-bg-surface);
  border: 1px solid var(--hn-border-default);
  border-radius: 8px;
  padding: 0 12px;
  height: 36px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.search-input-wrapper:focus-within {
  border-color: var(--hn-purple);
  box-shadow: 0 0 0 2px var(--hn-purple-muted);
}

.search-icon {
  color: var(--hn-text-muted);
  font-size: 18px;
  margin-right: 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--hn-text-primary);
  font-size: 14px;
  min-width: 0;
}

.search-input::placeholder {
  color: var(--hn-text-muted);
}

.clear-icon {
  color: var(--hn-text-muted);
  font-size: 18px;
  cursor: pointer;
  margin-left: 8px;
  flex-shrink: 0;
  transition: color 0.2s;
}

.clear-icon:hover {
  color: var(--hn-text-secondary);
}
</style>

<style>
/* Dropdown styles - not scoped to work with Teleport */
.search-dropdown {
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  max-height: 450px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 99999;
}

.search-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--hn-text-muted);
}

.search-loading ion-spinner {
  width: 20px;
  height: 20px;
  --color: var(--hn-purple);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 6px;
}

.section-header.has-top-border {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--hn-border-default);
}

.section-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hn-text-muted);
}

.section-count {
  font-size: 0.65rem;
  color: var(--hn-text-muted);
  background: var(--hn-bg-surface);
  padding: 2px 6px;
  border-radius: 10px;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.search-result-item:hover,
.search-result-item.is-selected {
  background: var(--hn-purple-muted);
}

.search-result-item.is-project {
  border-left: 3px solid var(--hn-green);
}

.result-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hn-purple-muted);
  border-radius: 6px;
}

.result-icon.project-icon {
  background: var(--hn-green-muted);
  color: var(--hn-green);
}

.result-icon ion-icon {
  font-size: 16px;
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--hn-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-name mark {
  background: var(--hn-purple-muted);
  color: var(--hn-purple-light);
  padding: 0 2px;
  border-radius: 2px;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--hn-text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-project {
  color: var(--hn-teal);
}

.result-path {
  color: var(--hn-text-faint);
}

.no-results {
  padding: 20px;
  text-align: center;
  color: var(--hn-text-muted);
  font-size: 14px;
}

.search-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 8px 14px;
  background: var(--hn-bg-surface);
  border-top: 1px solid var(--hn-border-default);
  font-size: 0.7rem;
  color: var(--hn-text-muted);
}

.search-footer span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.search-footer kbd {
  display: inline-block;
  padding: 2px 5px;
  font-size: 0.65rem;
  font-family: inherit;
  color: var(--hn-text-secondary);
  background: var(--hn-bg-elevated);
  border: 1px solid var(--hn-border-default);
  border-radius: 4px;
}
</style>

<template>
  <div class="file-map-container">
    <div class="file-map-header">
      <div class="file-map-title-row">
        <div class="file-map-title">
          <ion-icon :icon="gitNetworkOutline" />
          <span>File Map</span>
        </div>
        <div class="file-map-controls">
          <div class="scope-toggle" role="group" aria-label="Map scope">
            <button
              class="tl-btn"
              :class="{ active: !allProjects }"
              @click="allProjects = false"
            >
              This project
            </button>
            <button
              class="tl-btn"
              :class="{ active: allProjects }"
              @click="allProjects = true"
            >
              All projects
            </button>
          </div>
          <button class="tl-btn icon-btn" aria-label="Close file map" @click="$emit('close')">
            <ion-icon :icon="closeOutline" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="file-map-loading">
      <ion-spinner name="crescent" />
      <span>{{ loadingMessage }}</span>
    </div>

    <div v-else-if="graph.nodes.length === 0" class="file-map-empty">
      <ion-icon :icon="gitNetworkOutline" class="empty-icon" />
      <h3>No file connections yet</h3>
      <p>
        Link notes with <code>[[path/to/file.md]]</code>. Relative markdown links and
        <code>@file:</code> mentions in note bodies also count. Chat can insert
        <code>[[…]]</code> for known files when writing notes.
      </p>
    </div>

    <div v-else class="file-map-body" ref="bodyRef">
      <svg
        ref="svgRef"
        class="file-map-svg"
        @wheel.prevent="onWheel"
        @mousedown="onCanvasMouseDown"
      >
        <defs>
          <marker
            id="fm-arrow"
            viewBox="0 0 10 10"
            refX="18"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--hn-border-strong, #4a4a6a)" />
          </marker>
        </defs>
        <g :transform="`translate(${panX}, ${panY}) scale(${zoom})`">
          <line
            v-for="(edge, i) in renderedEdges"
            :key="'e-' + i"
            class="fm-edge"
            :x1="edge.x1"
            :y1="edge.y1"
            :x2="edge.x2"
            :y2="edge.y2"
            marker-end="url(#fm-arrow)"
          />
          <g
            v-for="node in simNodes"
            :key="node.id"
            class="fm-node"
            :transform="`translate(${node.x}, ${node.y})`"
            @mousedown.stop="onNodeMouseDown($event, node)"
            @click.stop="onNodeClick(node)"
            @mouseenter="hoveredId = node.id"
            @mouseleave="hoveredId = null"
          >
            <circle
              :r="nodeRadius(node.degree)"
              :class="{ hovered: hoveredId === node.id }"
            />
            <text
              class="fm-label"
              :y="nodeRadius(node.degree) + 12"
              text-anchor="middle"
            >
              {{ displayName(node) }}
            </text>
          </g>
        </g>
      </svg>
      <div v-if="hoveredNode" class="fm-tooltip">
        <strong>{{ hoveredNode.fileName }}</strong>
        <span v-if="allProjects">{{ projectLabel(hoveredNode.projectId) }}</span>
        <span>{{ hoveredNode.degree }} connection{{ hoveredNode.degree === 1 ? '' : 's' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import { closeOutline, gitNetworkOutline } from 'ionicons/icons';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import {
  ensureNoteLinksBackfill,
  onNoteLinksChanged,
  queryResolvedNoteLinks,
  getAllProjects,
} from '@/services';
import { buildFileLinkGraph, type FileLinkGraph } from '@/composables/buildFileLinkGraph';

interface SimNode extends SimulationNodeDatum {
  id: string;
  projectId: string;
  fileName: string;
  degree: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode | string | number;
  target: SimNode | string | number;
}

const props = defineProps<{
  projectId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-file', fileId: string, projectId: string): void;
}>();

const loading = ref(true);
const loadingMessage = ref('Building file map...');
const allProjects = ref(false);
const graph = ref<FileLinkGraph>({ nodes: [], edges: [] });
const simNodes = ref<SimNode[]>([]);
const simEdges = ref<SimLink[]>([]);
const hoveredId = ref<string | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const panX = ref(0);
const panY = ref(0);
const zoom = ref(1);
const projectNames = ref<Map<string, string>>(new Map());

let simulation: ReturnType<typeof forceSimulation<SimNode>> | null = null;
let unsubscribe: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let dragNode: SimNode | null = null;
let panning = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;
let nodeDragStartX = 0;
let nodeDragStartY = 0;
let nodeDragDistance = 0;
const NODE_CLICK_SLOP_PX = 6;

const hoveredNode = computed(() =>
  simNodes.value.find(n => n.id === hoveredId.value) ?? null,
);

const renderedEdges = computed(() =>
  simEdges.value.map(edge => {
    const source = edge.source as SimNode;
    const target = edge.target as SimNode;
    return {
      x1: source.x ?? 0,
      y1: source.y ?? 0,
      x2: target.x ?? 0,
      y2: target.y ?? 0,
    };
  }),
);

function displayName(node: SimNode): string {
  const base = node.fileName.split('/').pop() || node.fileName;
  if (allProjects.value) {
    const proj = projectNames.value.get(node.projectId);
    return proj ? `${proj}/${base}` : base;
  }
  return base;
}

function projectLabel(projectId: string): string {
  return projectNames.value.get(projectId) || projectId;
}

function nodeRadius(degree: number): number {
  return Math.min(22, 8 + Math.sqrt(Math.max(degree, 1)) * 4);
}

function stopSimulation() {
  simulation?.stop();
  simulation = null;
}

function startSimulation(g: FileLinkGraph) {
  stopSimulation();

  const width = bodyRef.value?.clientWidth || 800;
  const height = bodyRef.value?.clientHeight || 600;
  panX.value = width / 2;
  panY.value = height / 2;
  zoom.value = 1;

  const nodes: SimNode[] = g.nodes.map(n => ({
    ...n,
    x: (Math.random() - 0.5) * 200,
    y: (Math.random() - 0.5) * 200,
  }));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const links: SimLink[] = g.edges
    .filter(e => nodeById.has(e.source) && nodeById.has(e.target))
    .map(e => ({
      source: e.source,
      target: e.target,
    }));

  simNodes.value = nodes;
  simEdges.value = links;

  simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id(d => d.id)
        .distance(90)
        .strength(0.6),
    )
    .force('charge', forceManyBody().strength(-180))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide<SimNode>().radius(d => nodeRadius(d.degree) + 8))
    .on('tick', () => {
      simNodes.value = [...nodes];
      simEdges.value = [...links];
    });
}

async function loadData() {
  loading.value = true;
  loadingMessage.value = 'Indexing links...';
  try {
    await ensureNoteLinksBackfill(allProjects.value ? null : props.projectId);
    loadingMessage.value = 'Building file map...';

    const projects = await getAllProjects();
    projectNames.value = new Map(projects.map(p => [p.id, p.name]));

    const scopeProjectId = allProjects.value ? null : props.projectId;
    const rows = await queryResolvedNoteLinks(scopeProjectId);
    const resolved = rows
      .filter(r => r.targetFileId && r.targetProjectId && r.targetFileName)
      .map(r => ({
        sourceFileId: r.sourceFileId,
        sourceProjectId: r.sourceProjectId,
        sourceFileName: r.sourceFileName,
        targetFileId: r.targetFileId as string,
        targetProjectId: r.targetProjectId as string,
        targetFileName: r.targetFileName as string,
        linkType: r.linkType,
      }));

    graph.value = buildFileLinkGraph(resolved, {
      projectId: allProjects.value ? null : props.projectId,
    });
  } catch (err) {
    console.warn('Failed to load file map:', err);
    graph.value = { nodes: [], edges: [] };
  } finally {
    loading.value = false;
    await nextTick();
    if (graph.value.nodes.length > 0) {
      startSimulation(graph.value);
    } else {
      stopSimulation();
      simNodes.value = [];
      simEdges.value = [];
    }
  }
}

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    void loadData();
  }, 300);
}

function onWheel(event: WheelEvent) {
  const factor = event.deltaY < 0 ? 1.08 : 0.92;
  zoom.value = Math.min(3, Math.max(0.35, zoom.value * factor));
}

function onCanvasMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  panning = true;
  panStartX = event.clientX;
  panStartY = event.clientY;
  panOriginX = panX.value;
  panOriginY = panY.value;
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);
}

function onPanMove(event: MouseEvent) {
  if (!panning) return;
  panX.value = panOriginX + (event.clientX - panStartX);
  panY.value = panOriginY + (event.clientY - panStartY);
}

function onPanUp() {
  panning = false;
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanUp);
}

function onNodeMouseDown(event: MouseEvent, node: SimNode) {
  if (event.button !== 0) return;
  dragNode = node;
  nodeDragStartX = event.clientX;
  nodeDragStartY = event.clientY;
  nodeDragDistance = 0;
  node.fx = node.x;
  node.fy = node.y;
  simulation?.alphaTarget(0.3).restart();
  window.addEventListener('mousemove', onNodeDrag);
  window.addEventListener('mouseup', onNodeDragEnd);
}

function onNodeDrag(event: MouseEvent) {
  if (!dragNode) return;
  nodeDragDistance = Math.hypot(
    event.clientX - nodeDragStartX,
    event.clientY - nodeDragStartY,
  );
  // Only treat as a drag after leaving the click slop; tiny jitter must not block open-file.
  if (nodeDragDistance < NODE_CLICK_SLOP_PX) return;
  const dx = event.movementX / zoom.value;
  const dy = event.movementY / zoom.value;
  dragNode.fx = (dragNode.fx ?? dragNode.x ?? 0) + dx;
  dragNode.fy = (dragNode.fy ?? dragNode.y ?? 0) + dy;
}

function onNodeDragEnd() {
  if (dragNode) {
    dragNode.fx = null;
    dragNode.fy = null;
  }
  dragNode = null;
  simulation?.alphaTarget(0);
  window.removeEventListener('mousemove', onNodeDrag);
  window.removeEventListener('mouseup', onNodeDragEnd);
}

function onNodeClick(node: SimNode) {
  if (nodeDragDistance >= NODE_CLICK_SLOP_PX) return;
  emit('open-file', node.id, node.projectId);
}

watch(
  () => [props.projectId, allProjects.value] as const,
  () => {
    void loadData();
  },
);

onMounted(() => {
  void loadData();
  unsubscribe = onNoteLinksChanged(() => scheduleReload());
});

onUnmounted(() => {
  unsubscribe?.();
  if (reloadTimer) clearTimeout(reloadTimer);
  stopSimulation();
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanUp);
  window.removeEventListener('mousemove', onNodeDrag);
  window.removeEventListener('mouseup', onNodeDragEnd);
});
</script>

<style scoped>
.file-map-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--hn-bg-base, #0f0f1a);
  overflow: hidden;
}

.file-map-header {
  padding: 16px 24px 12px;
  background: var(--hn-bg-surface, #1a1a2e);
  border-bottom: 1px solid var(--hn-border-default, #2a2a4a);
}

.file-map-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.file-map-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--hn-text-primary, #e0e0e0);
}

.file-map-title ion-icon {
  font-size: 1.2rem;
  color: var(--hn-purple-light, #a78bfa);
}

.file-map-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scope-toggle {
  display: flex;
  gap: 4px;
}

.tl-btn {
  padding: 5px 12px;
  background: var(--hn-bg-elevated, #222244);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 6px;
  color: var(--hn-text-secondary, #aaa);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.tl-btn:hover {
  border-color: var(--hn-border-strong);
  color: var(--hn-text-primary, #e0e0e0);
}

.tl-btn.active {
  border-color: var(--hn-purple-light, #a78bfa);
  color: var(--hn-text-primary, #e0e0e0);
  background: rgba(167, 139, 250, 0.12);
}

.tl-btn.icon-btn {
  display: flex;
  align-items: center;
  padding: 5px 8px;
}

.tl-btn.icon-btn ion-icon {
  font-size: 1rem;
}

.file-map-loading,
.file-map-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--hn-text-secondary, #aaa);
  padding: 32px;
  text-align: center;
}

.file-map-empty h3 {
  margin: 0;
  color: var(--hn-text-primary, #e0e0e0);
  font-size: 1.1rem;
}

.file-map-empty p {
  max-width: 420px;
  margin: 0;
  line-height: 1.5;
  font-size: 0.9rem;
}

.file-map-empty code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  color: var(--hn-purple-light, #a78bfa);
}

.empty-icon {
  font-size: 2.5rem;
  opacity: 0.5;
}

.file-map-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.file-map-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.file-map-svg:active {
  cursor: grabbing;
}

.fm-edge {
  stroke: var(--hn-border-strong, #4a4a6a);
  stroke-width: 1.5;
  stroke-opacity: 0.75;
}

.fm-node {
  cursor: pointer;
}

.fm-node circle {
  fill: var(--hn-bg-elevated, #222244);
  stroke: var(--hn-purple-light, #a78bfa);
  stroke-width: 2;
  transition: fill 0.15s, stroke-width 0.15s;
}

.fm-node circle.hovered {
  fill: rgba(167, 139, 250, 0.25);
  stroke-width: 2.5;
}

.fm-label {
  fill: var(--hn-text-secondary, #aaa);
  font-size: 10px;
  pointer-events: none;
}

.fm-tooltip {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--hn-bg-surface, #1a1a2e);
  border: 1px solid var(--hn-border-default, #2a2a4a);
  border-radius: 8px;
  color: var(--hn-text-secondary, #aaa);
  font-size: 0.8rem;
  max-width: 320px;
  pointer-events: none;
}

.fm-tooltip strong {
  color: var(--hn-text-primary, #e0e0e0);
  font-weight: 600;
}
</style>

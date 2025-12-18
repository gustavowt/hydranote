/**
 * Note Service
 * Handles the AddNote tool pipeline for creating and storing markdown notes
 * Phase 9: AddNote tool implementation
 */

import type {
  AddNoteParams,
  AddNoteResult,
  NoteContextMetadata,
  DirectoryDecision,
  ProjectFile,
  ProjectSummary,
  ProjectRouterDecision,
  GlobalAddNoteParams,
  GlobalAddNoteResult,
} from "../types";
import {
  trackNoteCreated,
  trackProjectCreated,
  trackDirectoryCreated,
  trackNoteCreationFailed,
} from "./telemetryService";

// ============================================
// Execution Step Types (matching toolService pattern)
// ============================================

export interface NoteExecutionStep {
  id: string;
  status: "pending" | "running" | "completed" | "error" | "waiting";
  label: string;
  detail?: string;
}

export type NoteExecutionCallback = (steps: NoteExecutionStep[]) => void;
import { chatCompletion } from "./llmService";
import {
  getNoteFormatInstructions,
  getDefaultNoteDirectory,
} from "./llmService";
import {
  get_project_files,
  getProject,
  getAllProjects,
  createProject,
  createFile,
  indexFileForSearch,
} from "./projectService";
import { updateProjectStatus } from "./database";
import { flushDatabase } from "./database";

// ============================================
// Prompt Templates
// ============================================

/**
 * Prompt template for formatting raw note text into structured markdown
 */
function buildFormatNotePrompt(userInstructions: string): string {
  const basePrompt = `You are a note formatting assistant. Your task is to improve formatting of the note without
                      changing its original format or meaning. Use Markdown syntax to structure the content clearly.

Guidelines:
- Use clear headings (##, ###) to organize content
- Use bullet points or numbered lists where appropriate
- Preserve all important information from the original text
- Fix grammar and spelling errors
- Maintain a clean, readable structure
- Add emphasis (bold/italic) for key terms where helpful
- Keep the tone professional but accessible
- detect codeblocks and wrap them with triple backticks and the appropriate language tag
- charts, data, or tables should be formatted using markdown tables
- wrap data-flows or processes with mermaid syntax for flowcharts

Mermaid Syntax Rules (IMPORTANT):
- Use \`\`\`mermaid code blocks for diagrams
- When node labels contain special characters like (), {}, [], or quotes, wrap the label in double quotes: A["Label with (parentheses)"]
- Examples of correct syntax:
  - A[Simple Label] --> B[Another Label]
  - A["Label with (special) chars"] --> B["Method.call(arg)"]
  - A["API Response (data)"] --> B[Process]`;

  const customInstructions = userInstructions
    ? `\n\nUser's custom formatting instructions, THIS SHOULD OVERWRITE ANY PREVIOUS INSTRUCTIONS:\n${userInstructions}`
    : "";

  return `${basePrompt}${customInstructions}

IMPORTANT: Respond with ONLY the formatted Markdown content. Do not include any explanations, preamble, or meta-commentary about the formatting.`;
}

/**
 * Prompt template for generating a note title from content
 */
const GENERATE_TITLE_PROMPT = `You are a title generator. Given note content, generate a short, descriptive title.

Guidelines:
- Keep the title under 60 characters
- Make it descriptive but concise
- Use title case
- Do not use special characters that are invalid in filenames
- Focus on the main topic or theme of the note

IMPORTANT: Respond with ONLY the title text. No quotes, no explanations, just the title.`;

/**
 * Prompt template for deciding which directory to save the note in
 * Phase 12: Balanced guidelines for good organization
 */
function buildDecideDirectoryPrompt(existingDirectories: string[]): string {
  const dirList =
    existingDirectories.length > 0
      ? existingDirectories.map((d) => `  - ${d}`).join("\n")
      : "  (No existing directories)";

  return `You are a file organization assistant. Given a note's title and context, decide the best directory to save it in.

Existing directories in the project:
${dirList}

## Guidelines

1. **Check existing directories first**: If an existing directory fits the note's topic, use it.

2. **Create directories for good organization**: Feel free to create a new directory when:
   - The note has a clear, specific topic that deserves its own category
   - It would help keep the project organized
   - The topic is distinct from existing directories

3. **Directory naming**:
   - Use lowercase, hyphen-separated names (e.g., "meeting-notes", "project-ideas")
   - Be specific enough to be useful (e.g., "client-meetings" instead of just "stuff")
   - Keep depth reasonable (1-2 levels max)

4. **Default behavior**: If unsure, use "notes" as a general catch-all directory.

## Response Format
Respond with a JSON object ONLY:
{"targetDirectory": "path/to/directory", "shouldCreateDirectory": true/false, "reasoning": "brief explanation"}

## Examples

Given directories: [notes, meetings]
- "Weekly team standup notes" → {"targetDirectory": "meetings", "shouldCreateDirectory": false, "reasoning": "Fits existing meetings directory"}
- "API design decisions" → {"targetDirectory": "architecture", "shouldCreateDirectory": true, "reasoning": "Architecture decisions deserve their own category"}
- "Recipe for pasta" → {"targetDirectory": "personal", "shouldCreateDirectory": true, "reasoning": "Personal content separate from work"}
- "Random thought" → {"targetDirectory": "notes", "shouldCreateDirectory": false, "reasoning": "General note goes to notes"}

Given directories: [notes]
- "Meeting with client X" → {"targetDirectory": "meetings", "shouldCreateDirectory": true, "reasoning": "Meeting notes should have their own directory"}
- "Quick reminder" → {"targetDirectory": "notes", "shouldCreateDirectory": false, "reasoning": "General note fits in notes"}`;
}

// ============================================
// Pipeline Step 1: Format Note
// ============================================

/**
 * Format raw note text into structured markdown using LLM
 */
export async function formatNote(
  rawText: string,
  metadata?: NoteContextMetadata,
): Promise<string> {
  const formatInstructions = getNoteFormatInstructions();
  const systemPrompt = buildFormatNotePrompt(formatInstructions);

  let userContent = rawText;

  // Add context metadata if provided
  if (metadata) {
    const contextParts: string[] = [];
    if (metadata.topic) contextParts.push(`Topic: ${metadata.topic}`);
    if (metadata.tags?.length)
      contextParts.push(`Tags: ${metadata.tags.join(", ")}`);
    if (metadata.source) contextParts.push(`Source: ${metadata.source}`);
    if (metadata.language) contextParts.push(`Language: ${metadata.language}`);

    if (contextParts.length > 0) {
      userContent = `[Context]\n${contextParts.join("\n")}\n\n[Note Content]\n${rawText}`;
    }
  }

  const response = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    maxTokens: 4000,
  });

  return response.content.trim();
}

// ============================================
// Pipeline Step 2: Generate File Name
// ============================================

/**
 * Generate a title for the note using LLM
 */
export async function generateNoteTitle(noteContent: string): Promise<string> {
  const response = await chatCompletion({
    messages: [
      { role: "system", content: GENERATE_TITLE_PROMPT },
      { role: "user", content: noteContent.slice(0, 2000) }, // Limit content for efficiency
    ],
    temperature: 0.5,
    maxTokens: 100,
  });

  return response.content.trim();
}

/**
 * Convert a title to a URL-safe slug for filename
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .slice(0, 80); // Limit length
}

/**
 * Generate a unique filename, adding suffix if needed
 */
export async function generateUniqueFileName(
  projectId: string,
  baseSlug: string,
  directory: string,
): Promise<string> {
  const files = await get_project_files(projectId);
  const existingNames = new Set(files.map((f) => f.name.toLowerCase()));

  let fileName = `${baseSlug}.md`;
  let counter = 1;

  // Check if file exists in the target directory
  while (
    existingNames.has(fileName.toLowerCase()) ||
    existingNames.has(`${directory}/${fileName}`.toLowerCase())
  ) {
    fileName = `${baseSlug}-${counter}.md`;
    counter++;

    // Safety limit
    if (counter > 100) {
      fileName = `${baseSlug}-${Date.now()}.md`;
      break;
    }
  }

  return fileName;
}

// ============================================
// Pipeline Step 3: Decide Directory
// ============================================

/**
 * Extract existing directory paths from project files
 */
export async function getProjectDirectories(
  projectId: string,
): Promise<string[]> {
  const files = await get_project_files(projectId);
  const directories = new Set<string>();

  // Add default note directory
  directories.add(getDefaultNoteDirectory());

  // Extract directories from existing file paths
  for (const file of files) {
    const lastSlash = file.name.lastIndexOf("/");
    if (lastSlash > 0) {
      const dir = file.name.substring(0, lastSlash);
      directories.add(dir);

      // Also add parent directories
      const parts = dir.split("/");
      let path = "";
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        directories.add(path);
      }
    }
  }

  return Array.from(directories).sort();
}

/**
 * Extended directory decision with reasoning for audit
 */
interface DirectoryDecisionWithReasoning extends DirectoryDecision {
  reasoning?: string;
}

/**
 * Decide which directory to save the note in using LLM
 * Phase 12: Enhanced with telemetry tracking for new directories
 */
export async function decideNoteDirectory(
  projectId: string,
  noteTitle: string,
  metadata?: NoteContextMetadata,
): Promise<DirectoryDecision> {
  const existingDirectories = await getProjectDirectories(projectId);
  return decideNoteDirectoryWithDirs(
    projectId,
    noteTitle,
    existingDirectories,
    metadata,
  );
}

/**
 * Decide which directory to save the note in using LLM
 * This version accepts pre-fetched directories for parallel execution optimization
 * Phase 12: Enhanced with telemetry tracking for new directories
 */
export async function decideNoteDirectoryWithDirs(
  projectId: string,
  noteTitle: string,
  existingDirectories: string[],
  metadata?: NoteContextMetadata,
): Promise<DirectoryDecision> {
  const systemPrompt = buildDecideDirectoryPrompt(existingDirectories);

  let context = `Note title: "${noteTitle}"`;
  if (metadata?.topic) context += `\nTopic: ${metadata.topic}`;
  if (metadata?.tags?.length) context += `\nTags: ${metadata.tags.join(", ")}`;

  const response = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ],
    temperature: 0.2,
    maxTokens: 300,
  });

  try {
    // Extract JSON from response
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
    const decision: DirectoryDecisionWithReasoning = {
      targetDirectory: parsed.targetDirectory || getDefaultNoteDirectory(),
      shouldCreateDirectory: parsed.shouldCreateDirectory === true,
      reasoning: parsed.reasoning,
    };

    // Phase 12: Track new directory creation for audit
    if (decision.shouldCreateDirectory) {
      trackDirectoryCreated({
        projectId,
        directoryPath: decision.targetDirectory,
        triggeringNoteTitle: noteTitle,
        reasoning: decision.reasoning,
      });
    }

    return {
      targetDirectory: decision.targetDirectory,
      shouldCreateDirectory: decision.shouldCreateDirectory,
    };
  } catch {
    // Fallback to default directory if parsing fails
    return {
      targetDirectory: getDefaultNoteDirectory(),
      shouldCreateDirectory: false,
    };
  }
}

// ============================================
// Pipeline Step 4: Persist Note
// ============================================

/**
 * Save note to database as a project file
 * Uses centralized createFile from projectService for consistent DB + FS sync
 */
export async function persistNote(
  projectId: string,
  fileName: string,
  directory: string,
  content: string,
): Promise<ProjectFile> {
  // Build full path
  const fullPath = directory ? `${directory}/${fileName}` : fileName;

  // Use centralized createFile (handles DB insert + file system sync)
  return createFile(projectId, fullPath, content, "md");
}

// ============================================
// Pipeline Step 5: Index Note
// ============================================

/**
 * Index the note for search (create chunks and embeddings)
 * Uses centralized indexFileForSearch from projectService
 */
export async function indexNote(file: ProjectFile): Promise<void> {
  if (!file.content) return;

  // Use centralized indexing function
  await indexFileForSearch(file.projectId, file.id, file.content, "md");
}

// ============================================
// Main AddNote Pipeline
// ============================================

/**
 * Execute the full AddNote pipeline
 * Phase 12: Enhanced with telemetry tracking
 * Phase 13: Optimized with parallel execution
 *
 * Pipeline steps (optimized for parallelism):
 * Phase 1 (parallel): Format note, Generate title, Pre-fetch directories
 * Phase 2 (sequential): Decide directory using pre-fetched data
 * Phase 3 (sequential): Generate filename, Persist, Index
 */
export async function addNote(params: AddNoteParams): Promise<AddNoteResult> {
  const { projectId, rawNoteText, contextMetadata } = params;

  try {
    // Validate project exists
    const project = await getProject(projectId);
    if (!project) {
      trackNoteCreationFailed(
        "project_chat",
        `Project not found: ${projectId}`,
        projectId,
      );
      return {
        success: false,
        filePath: "",
        title: "",
        directory: "",
        fileId: "",
        createdAt: new Date(),
        error: `Project not found: ${projectId}`,
      };
    }

    // Phase 1: Run format, title generation, and directory fetch in PARALLEL
    // This reduces 3 sequential LLM calls to 2 parallel + 1 sequential
    const [formattedContent, title, existingDirectories] = await Promise.all([
      formatNote(rawNoteText, contextMetadata),
      generateNoteTitle(rawNoteText), // Use raw text - works just as well for title
      getProjectDirectories(projectId), // Pre-fetch directories
    ]);

    const slug = titleToSlug(title);

    // Phase 2: Decide directory using pre-fetched directories (sequential LLM call)
    const { targetDirectory } = await decideNoteDirectoryWithDirs(
      projectId,
      title,
      existingDirectories,
      contextMetadata,
    );

    // Phase 3: Generate unique filename, persist, and index (sequential)
    const fileName = await generateUniqueFileName(
      projectId,
      slug,
      targetDirectory,
    );

    const file = await persistNote(
      projectId,
      fileName,
      targetDirectory,
      formattedContent,
    );

    await indexNote(file);

    // Update project status to indexed
    await updateProjectStatus(projectId, "indexed");
    await flushDatabase();

    // Phase 12: Track successful note creation from project chat
    trackNoteCreated({
      source: "project_chat",
      projectId,
      autoSelected: false, // Project was already selected
      filePath: file.name,
    });

    return {
      success: true,
      filePath: file.name,
      title,
      directory: targetDirectory,
      fileId: file.id,
      createdAt: file.createdAt,
    };
  } catch (error) {
    trackNoteCreationFailed(
      "project_chat",
      error instanceof Error ? error.message : "Unknown error",
      projectId,
    );
    return {
      success: false,
      filePath: "",
      title: "",
      directory: "",
      fileId: "",
      createdAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Add note with explicit title (skip title generation)
 * Phase 13: Optimized with parallel execution
 */
export async function addNoteWithTitle(
  projectId: string,
  rawNoteText: string,
  title: string,
  contextMetadata?: NoteContextMetadata,
): Promise<AddNoteResult> {
  try {
    // Validate project exists
    const project = await getProject(projectId);
    if (!project) {
      return {
        success: false,
        filePath: "",
        title: "",
        directory: "",
        fileId: "",
        createdAt: new Date(),
        error: `Project not found: ${projectId}`,
      };
    }

    const slug = titleToSlug(title);

    // Phase 1: Run format and directory fetch in PARALLEL
    const [formattedContent, existingDirectories] = await Promise.all([
      formatNote(rawNoteText, contextMetadata),
      getProjectDirectories(projectId), // Pre-fetch directories
    ]);

    // Phase 2: Decide directory using pre-fetched directories
    const { targetDirectory } = await decideNoteDirectoryWithDirs(
      projectId,
      title,
      existingDirectories,
      contextMetadata,
    );

    // Phase 3: Generate unique filename, persist, and index
    const fileName = await generateUniqueFileName(
      projectId,
      slug,
      targetDirectory,
    );

    const file = await persistNote(
      projectId,
      fileName,
      targetDirectory,
      formattedContent,
    );

    await indexNote(file);

    // Update project status to indexed
    await updateProjectStatus(projectId, "indexed");
    await flushDatabase();

    return {
      success: true,
      filePath: file.name,
      title,
      directory: targetDirectory,
      fileId: file.id,
      createdAt: file.createdAt,
    };
  } catch (error) {
    return {
      success: false,
      filePath: "",
      title: "",
      directory: "",
      fileId: "",
      createdAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ============================================
// Phase 10: Global Project Router
// ============================================

/**
 * Prompt template for deciding which project a note belongs to
 * Phase 12: Balanced guidelines for project organization
 */
function buildDecideTargetProjectPrompt(projects: ProjectSummary[]): string {
  const projectList =
    projects.length > 0
      ? projects
          .map(
            (p) =>
              `  - ID: "${p.id}" | Name: "${p.name}"${p.description ? ` | Description: ${p.description}` : ""}`,
          )
          .join("\n")
      : "  (No existing projects)";

  return `You are a project classification assistant. Given a note's content, decide which project it belongs to.

Existing projects:
${projectList}

## Guidelines

1. **Check existing projects first**: If an existing project clearly fits the note's topic, use it.

2. **Create new projects when appropriate**: Feel free to suggest a new project when:
   - The note is about a distinct topic not covered by existing projects
   - It would help the user stay organized
   - The topic deserves its own dedicated space

3. **Project naming**: When creating a new project:
   - Use clear, descriptive names (e.g., "Travel Planning", "Home Renovation", "Book Notes")
   - Keep names concise but specific

4. **When in doubt**: If the note could fit multiple projects, choose the most relevant one.

5. **New projects require confirmation**: Always set requiresConfirmation: true when suggesting a new project.

## Response Format
Respond with a JSON object ONLY:
{
  "action": "use_existing" | "create_project",
  "targetProjectId": "project-id-here" (only if action is "use_existing"),
  "proposedProjectName": "New Project Name" (only if action is "create_project"),
  "proposedProjectDescription": "Brief description" (only if action is "create_project"),
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation of why this project was chosen",
  "requiresConfirmation": true (only if action is "create_project")
}

## Examples

Given projects: [Work Notes, Personal]
- "Meeting notes from standup" → use_existing: Work Notes
- "Grocery shopping list" → use_existing: Personal
- "Learning Spanish vocabulary" → create_project: "Language Learning" (distinct topic)
- "Recipe for pasta" → use_existing: Personal OR create_project: "Recipes" (user preference)

Given projects: [Software Development]
- "API design notes" → use_existing: Software Development
- "Vacation planning ideas" → create_project: "Travel" (unrelated to software)
- "Book review: Clean Code" → use_existing: Software Development (related to dev)

Given projects: []
- Any note → create_project with appropriate name and requiresConfirmation: true`;
}

/**
 * Decide which project a note should be added to
 * Phase 12: Enhanced with confirmation requirement for new projects
 */
export async function decideTargetProject(
  noteContent: string,
  tags?: string[],
): Promise<ProjectRouterDecision> {
  // Get all existing projects
  const projects = await getAllProjects();
  const projectSummaries: ProjectSummary[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));

  // If no projects exist, suggest creating one (requires confirmation)
  if (projectSummaries.length === 0) {
    // Generate a project name from the note content
    const titleResponse = await chatCompletion({
      messages: [
        {
          role: "system",
          content:
            "Generate a short, descriptive project name (2-4 words) for organizing notes about this topic. Respond with ONLY the project name, no quotes or explanation.",
        },
        { role: "user", content: noteContent.slice(0, 1000) },
      ],
      temperature: 0.5,
      maxTokens: 50,
    });

    return {
      action: "create_project",
      proposedProjectName: titleResponse.content.trim() || "My Notes",
      proposedProjectDescription: "Auto-created project for notes",
      confidence: "high",
      reasoning: "No existing projects available",
      requiresConfirmation: true, // Phase 12: Always require confirmation
    };
  }

  const systemPrompt = buildDecideTargetProjectPrompt(projectSummaries);

  let userContent = `Note content:\n${noteContent.slice(0, 2000)}`;
  if (tags && tags.length > 0) {
    userContent += `\n\nTags: ${tags.join(", ")}`;
  }

  const response = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    maxTokens: 400,
  });

  try {
    // Extract JSON from response
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    // Validate the decision
    if (parsed.action === "use_existing") {
      // Verify the project exists
      const projectExists = projectSummaries.some(
        (p) => p.id === parsed.targetProjectId,
      );
      if (!projectExists) {
        // Fallback to first project if the suggested one doesn't exist
        return {
          action: "use_existing",
          targetProjectId: projectSummaries[0].id,
          confidence: "medium",
          reasoning: "Fallback to first available project",
        };
      }
    }

    // Phase 12: Ensure create_project always requires confirmation
    const requiresConfirmation =
      parsed.action === "create_project" ? true : undefined;

    return {
      action: parsed.action || "use_existing",
      targetProjectId: parsed.targetProjectId,
      proposedProjectName: parsed.proposedProjectName,
      proposedProjectDescription: parsed.proposedProjectDescription,
      confidence: parsed.confidence || "medium",
      reasoning: parsed.reasoning,
      requiresConfirmation,
    };
  } catch {
    // Fallback: assign to first project or suggest creating one
    if (projectSummaries.length > 0) {
      return {
        action: "use_existing",
        targetProjectId: projectSummaries[0].id,
        confidence: "low",
        reasoning: "Fallback due to parsing error",
      };
    }

    return {
      action: "create_project",
      proposedProjectName: "General Notes",
      proposedProjectDescription: "Default project for notes",
      confidence: "low",
      reasoning: "Fallback due to parsing error",
      requiresConfirmation: true, // Phase 12: Require confirmation
    };
  }
}

/**
 * Helper to update execution steps
 */
function updateStep(
  steps: NoteExecutionStep[],
  id: string,
  updates: Partial<NoteExecutionStep>,
  callback?: NoteExecutionCallback,
): NoteExecutionStep[] {
  const newSteps = steps.map((s) => (s.id === id ? { ...s, ...updates } : s));
  callback?.(newSteps);
  return newSteps;
}

/**
 * Global add note pipeline - adds a note from the dashboard
 * Phase 12: Enhanced with confirmation flow and telemetry tracking
 * Phase 13: Optimized with parallel execution
 *
 * Pipeline steps (optimized for parallelism):
 * 1. Decide target project (sequential - cannot parallelize)
 * 2. Format note, Generate title, Pre-fetch directories (PARALLEL)
 * 3. Decide directory (sequential)
 * 4. Save note to project
 * 5. Index for search
 */
export async function globalAddNote(
  params: GlobalAddNoteParams,
  onProgress?: NoteExecutionCallback,
): Promise<GlobalAddNoteResult> {
  const {
    rawNoteText,
    tags,
    skipProjectConfirmation,
    confirmedProjectId,
    confirmedNewProject,
  } = params;

  // Initialize execution steps
  let steps: NoteExecutionStep[] = [
    { id: "router", status: "pending", label: "Deciding target project" },
    { id: "parallel", status: "pending", label: "Formatting note" },
    { id: "directory", status: "pending", label: "Choosing directory" },
    { id: "save", status: "pending", label: "Saving note" },
    { id: "index", status: "pending", label: "Indexing for search" },
  ];
  onProgress?.(steps);

  try {
    let projectId: string;
    let projectName: string;
    let newProjectCreated = false;

    // Step 1: Decide target project (may require user confirmation)
    steps = updateStep(steps, "router", { status: "running" }, onProgress);

    // Check if user already confirmed a project choice
    if (confirmedProjectId) {
      // User confirmed to use an existing project
      const project = await getProject(confirmedProjectId);
      if (!project) {
        steps = updateStep(
          steps,
          "router",
          { status: "error", detail: "Project not found" },
          onProgress,
        );
        trackNoteCreationFailed(
          "dashboard",
          "Confirmed project not found",
          confirmedProjectId,
        );
        return {
          success: false,
          projectId: "",
          projectName: "",
          newProjectCreated: false,
          filePath: "",
          title: "",
          fileId: "",
          error: "Confirmed project not found",
        };
      }
      projectId = project.id;
      projectName = project.name;
      steps = updateStep(
        steps,
        "router",
        { status: "completed", detail: projectName },
        onProgress,
      );
    } else if (confirmedNewProject) {
      // User confirmed to create a new project
      steps = updateStep(
        steps,
        "router",
        {
          status: "running",
          detail: `Creating project: ${confirmedNewProject.name}`,
        },
        onProgress,
      );

      const newProject = await createProject(
        confirmedNewProject.name,
        confirmedNewProject.description,
      );
      projectId = newProject.id;
      projectName = newProject.name;
      newProjectCreated = true;

      // Phase 12: Track project creation (user confirmed)
      trackProjectCreated({
        projectId,
        automatic: false,
        reason: "ai_suggested",
      });

      steps = updateStep(
        steps,
        "router",
        {
          status: "completed",
          detail: `Created: ${projectName}`,
        },
        onProgress,
      );
    } else {
      // No pre-confirmation, run the AI router
      const routerDecision = await decideTargetProject(rawNoteText, tags);

      // Phase 12: Check if confirmation is required for new project
      if (
        routerDecision.action === "create_project" &&
        routerDecision.requiresConfirmation &&
        !skipProjectConfirmation
      ) {
        // Return early with pending confirmation
        steps = updateStep(
          steps,
          "router",
          {
            status: "completed",
            detail: "Confirmation needed",
          },
          onProgress,
        );

        return {
          success: false,
          projectId: "",
          projectName: "",
          newProjectCreated: false,
          filePath: "",
          title: "",
          fileId: "",
          pendingConfirmation: {
            proposedProjectName:
              routerDecision.proposedProjectName || "New Project",
            proposedProjectDescription:
              routerDecision.proposedProjectDescription,
            reasoning: routerDecision.reasoning,
          },
        };
      }

      if (routerDecision.action === "create_project") {
        // Create a new project (either no confirmation required or skipProjectConfirmation=true)
        steps = updateStep(
          steps,
          "router",
          {
            status: "running",
            detail: `Creating project: ${routerDecision.proposedProjectName}`,
          },
          onProgress,
        );

        const newProject = await createProject(
          routerDecision.proposedProjectName || "New Project",
          routerDecision.proposedProjectDescription,
        );
        projectId = newProject.id;
        projectName = newProject.name;
        newProjectCreated = true;

        // Phase 12: Track automatic project creation
        trackProjectCreated({
          projectId,
          automatic: true,
          reason: "ai_suggested",
        });

        steps = updateStep(
          steps,
          "router",
          {
            status: "completed",
            detail: `Created: ${projectName}`,
          },
          onProgress,
        );
      } else {
        // Use existing project
        projectId = routerDecision.targetProjectId!;
        const project = await getProject(projectId);
        if (!project) {
          steps = updateStep(
            steps,
            "router",
            { status: "error", detail: "Project not found" },
            onProgress,
          );
          trackNoteCreationFailed(
            "dashboard",
            "Target project not found",
            projectId,
          );
          return {
            success: false,
            projectId: "",
            projectName: "",
            newProjectCreated: false,
            filePath: "",
            title: "",
            fileId: "",
            error: "Target project not found",
          };
        }
        projectName = project.name;
        steps = updateStep(
          steps,
          "router",
          {
            status: "completed",
            detail: projectName,
          },
          onProgress,
        );
      }
    }

    // Phase 13: Run format, title, and directory fetch in PARALLEL
    steps = updateStep(
      steps,
      "parallel",
      { status: "running", detail: "Formatting & generating title..." },
      onProgress,
    );

    const contextMetadata: NoteContextMetadata = tags ? { tags } : {};
    const [formattedContent, title, existingDirectories] = await Promise.all([
      formatNote(rawNoteText, contextMetadata),
      generateNoteTitle(rawNoteText), // Use raw text - works just as well for title
      getProjectDirectories(projectId), // Pre-fetch directories
    ]);

    const slug = titleToSlug(title);
    steps = updateStep(
      steps,
      "parallel",
      { status: "completed", detail: title },
      onProgress,
    );

    // Step 3: Decide directory using pre-fetched directories
    steps = updateStep(steps, "directory", { status: "running" }, onProgress);
    const { targetDirectory } = await decideNoteDirectoryWithDirs(
      projectId,
      title,
      existingDirectories,
      contextMetadata,
    );
    steps = updateStep(
      steps,
      "directory",
      { status: "completed", detail: targetDirectory },
      onProgress,
    );

    // Step 4: Save the note
    steps = updateStep(steps, "save", { status: "running" }, onProgress);
    const fileName = await generateUniqueFileName(
      projectId,
      slug,
      targetDirectory,
    );
    const file = await persistNote(
      projectId,
      fileName,
      targetDirectory,
      formattedContent,
    );
    steps = updateStep(
      steps,
      "save",
      { status: "completed", detail: file.name },
      onProgress,
    );

    // Step 5: Index the note
    steps = updateStep(steps, "index", { status: "running" }, onProgress);
    await indexNote(file);

    // Update project status to indexed
    await updateProjectStatus(projectId, "indexed");
    await flushDatabase();

    steps = updateStep(steps, "index", { status: "completed" }, onProgress);

    // Phase 12: Track successful note creation
    trackNoteCreated({
      source: "dashboard",
      projectId,
      autoSelected: !confirmedProjectId && !confirmedNewProject,
      filePath: file.name,
    });

    return {
      success: true,
      projectId,
      projectName,
      newProjectCreated,
      filePath: file.name,
      title,
      fileId: file.id,
    };
  } catch (error) {
    // Mark any running step as error
    steps = steps.map((s) =>
      s.status === "running"
        ? {
            ...s,
            status: "error" as const,
            detail: error instanceof Error ? error.message : "Error",
          }
        : s,
    );
    onProgress?.(steps);

    // Phase 12: Track failed note creation
    trackNoteCreationFailed(
      "dashboard",
      error instanceof Error ? error.message : "Unknown error",
    );

    return {
      success: false,
      projectId: "",
      projectName: "",
      newProjectCreated: false,
      filePath: "",
      title: "",
      fileId: "",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

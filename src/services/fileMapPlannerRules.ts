/**
 * Planner instructions for File Map wikilinks.
 * Kept separate so unit tests can assert the contract without loading toolService.
 */
export const FILE_MAP_WIKILINK_PLANNER_RULES = `FILE CROSS-REFERENCES (File Map):
- When writing or updating note content (write / updateFile) that names another known file, insert a durable wikilink: [[path/to/file.md]]
- In the current project use the project-relative path. Cross-project: [[ProjectName/path/to/file.md]]
- Only link files that appear in the available file list or that you successfully resolved — NEVER invent paths or guess filenames
- Keep @file: for chat mentions and tool targeting; use [[…]] inside note bodies so the File Map can index connections
- Prefer [[wikilinks]] over plain filename mentions when the target file is known`;

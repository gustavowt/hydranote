/**
 * Normalizes user input for file rename.
 * If the user types a name that already includes the file's extension (e.g. "new.md"),
 * the extension is preserved without duplicating it (avoiding "new.md.md").
 * If the user types just the base name (e.g. "new"), the extension is appended.
 */
export function normalizeRenameInput(input: string, ext: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (!ext) return trimmed;

  // Case-insensitive check for trailing extension
  if (trimmed.toLowerCase().endsWith(ext.toLowerCase())) {
    const base = trimmed.slice(0, trimmed.length - ext.length);
    return base + ext;
  }

  return trimmed + ext;
}

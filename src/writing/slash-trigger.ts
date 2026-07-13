import type { EditorPosition, EditorSuggestTriggerInfo } from "obsidian";

export function slashTrigger(lineBeforeCursor: string, cursor: EditorPosition): EditorSuggestTriggerInfo | null {
  const match = /^(\s*)\/([^/\s]*)$/.exec(lineBeforeCursor);
  if (!match) return null;
  const start = { line: cursor.line, ch: match[1].length };
  return { start, end: { ...cursor }, query: match[2] };
}

import { MarkdownView, type App, type Editor, type MarkdownFileInfo, type TFile } from "obsidian";
import type { ContextBundle, ContextChip, EditorSnapshot } from "../types";

export class ContextService {
  constructor(private readonly app: App) {}

  getSelectionBundle(): ContextBundle | undefined {
    const active = this.activeEditor();
    if (!active) return undefined;
    const selection = active.editor.getSelection();
    if (!selection) return undefined;
    const from = active.editor.getCursor("from");
    const to = active.editor.getCursor("to");
    const cursor = active.editor.getCursor();
    const headings = headingPath(active.editor, cursor.line);
    const surrounding = surroundingParagraphs(active.editor, cursor.line);
    const chips: ContextChip[] = [
      {
        id: "selection",
        type: "selection",
        label: `选区 ${selection.length} 字`,
        content: selection,
        filePath: active.file.path
      }
    ];
    return {
      chips,
      promptContext: formatContext(active.file, headings, selection, surrounding.current, surrounding.previous),
      snapshot: snapshot(active.file, "selection", from, to, selection, cursor),
      fileTitle: active.file.basename,
      headingPath: headings
    };
  }

  getParagraphBundle(): ContextBundle | undefined {
    const active = this.activeEditor();
    if (!active) return undefined;
    const cursor = active.editor.getCursor();
    const paragraphs = surroundingParagraphs(active.editor, cursor.line);
    const content = paragraphs.current || paragraphs.previous;
    if (!content) return undefined;
    const headings = headingPath(active.editor, cursor.line);
    const chip: ContextChip = {
      id: "paragraph",
      type: "paragraph",
      label: "当前段落",
      content,
      filePath: active.file.path
    };
    return {
      chips: [chip],
      promptContext: formatContext(active.file, headings, "", paragraphs.current, paragraphs.previous),
      snapshot: snapshot(active.file, "cursor", cursor, cursor, "", cursor),
      fileTitle: active.file.basename,
      headingPath: headings
    };
  }

  getCursorBundle(): ContextBundle | undefined {
    const active = this.activeEditor();
    if (!active) return undefined;
    const cursor = active.editor.getCursor();
    const paragraphs = surroundingParagraphs(active.editor, cursor.line);
    const content = paragraphs.current || paragraphs.previous;
    const headings = headingPath(active.editor, cursor.line);
    const chips: ContextChip[] = content ? [{
      id: "paragraph",
      type: "paragraph",
      label: "当前段落",
      content,
      filePath: active.file.path
    }] : [];
    return {
      chips,
      promptContext: formatContext(active.file, headings, "", paragraphs.current, paragraphs.previous),
      snapshot: snapshot(active.file, "cursor", cursor, cursor, "", cursor),
      fileTitle: active.file.basename,
      headingPath: headings
    };
  }

  getCurrentNoteChip(): ContextChip | undefined {
    const active = this.activeEditor();
    if (!active) return undefined;
    return {
      id: "current-note",
      type: "note",
      label: `当前页面：${active.file.basename}`,
      content: active.editor.getValue(),
      filePath: active.file.path,
      followsActiveNote: true
    };
  }

  async getNoteChip(file: TFile): Promise<ContextChip> {
    const active = this.activeEditor();
    const content = active?.file.path === file.path
      ? active.editor.getValue()
      : await this.app.vault.cachedRead(file);
    return {
      id: `note:${file.path}`,
      type: "note",
      label: file.basename,
      content,
      filePath: file.path
    };
  }

  listMarkdownNotes(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  }

  private activeEditor(): { editor: Editor; file: TFile } | undefined {
    const active = this.app.workspace.activeEditor;
    if (active?.file && active.editor) return { editor: active.editor, file: active.file };
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file) return { editor: view.editor, file: view.file };
    const activeFile = this.app.workspace.getActiveFile();
    const openViews = this.app.workspace.getLeavesOfType("markdown")
      .map((leaf) => leaf.view as unknown as MarkdownFileInfo)
      .filter((candidate) => candidate.file !== null && candidate.editor !== undefined);
    const openView = openViews.find((candidate) => candidate.file?.path === activeFile?.path) ?? openViews[0];
    if (!openView?.file || !openView.editor) return undefined;
    return { editor: openView.editor, file: openView.file };
  }
}

function snapshot(
  file: TFile,
  mode: EditorSnapshot["mode"],
  from: EditorSnapshot["from"],
  to: EditorSnapshot["to"],
  originalText: string,
  cursor: EditorSnapshot["cursor"]
): EditorSnapshot {
  return {
    filePath: file.path,
    mode,
    from: { ...from },
    to: { ...to },
    originalText,
    cursor: { ...cursor },
    createdAt: Date.now()
  };
}

function headingPath(editor: Editor, line: number): string[] {
  const levels = new Map<number, string>();
  for (let index = 0; index <= line; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(editor.getLine(index));
    if (!match) continue;
    const level = match[1].length;
    levels.set(level, match[2]);
    for (const key of [...levels.keys()]) if (key > level) levels.delete(key);
  }
  return [...levels.entries()].sort(([a], [b]) => a - b).map(([, title]) => title);
}

export function surroundingParagraphs(editor: Editor, line: number): { current: string; previous: string } {
  const last = editor.lineCount() - 1;
  const start = paragraphStart(editor, Math.min(Math.max(line, 0), last));
  const end = paragraphEnd(editor, start, last);
  const current = collectLines(editor, start, end).trim();
  let probe = start - 1;
  while (probe >= 0 && editor.getLine(probe).trim() === "") probe -= 1;
  const previousEnd = probe;
  while (probe >= 0 && editor.getLine(probe).trim() !== "") probe -= 1;
  const previous = previousEnd >= 0 ? collectLines(editor, probe + 1, previousEnd).trim() : "";
  return { current, previous };
}

function paragraphStart(editor: Editor, line: number): number {
  if (editor.getLine(line).trim() === "") return line;
  let start = line;
  while (start > 0 && editor.getLine(start - 1).trim() !== "") start -= 1;
  return start;
}

function paragraphEnd(editor: Editor, start: number, last: number): number {
  if (editor.getLine(start).trim() === "") return start;
  let end = start;
  while (end < last && editor.getLine(end + 1).trim() !== "") end += 1;
  return end;
}

function collectLines(editor: Editor, start: number, end: number): string {
  const lines: string[] = [];
  for (let index = start; index <= end; index += 1) lines.push(editor.getLine(index));
  return lines.join("\n");
}

function formatContext(
  file: TFile,
  headings: string[],
  selection: string,
  current: string,
  previous: string
): string {
  return [
    `文件：${file.path}`,
    headings.length ? `标题路径：${headings.join(" > ")}` : "",
    previous ? `前一段：\n${previous}` : "",
    current ? `当前段：\n${current}` : "",
    selection ? `选中文字：\n${selection}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

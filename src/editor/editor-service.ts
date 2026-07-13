import { MarkdownView, type App, type MarkdownFileInfo } from "obsidian";
import type { ApplyResult, EditorSnapshot } from "../types";

export class EditorService {
  constructor(private readonly app: App) {}

  apply(snapshot: EditorSnapshot, text: string, mode: "replace" | "insert-after" | "insert-cursor"): ApplyResult {
    const active = this.app.workspace.activeEditor;
    let view: MarkdownFileInfo | null | undefined = active?.file && active.editor ? active : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      const activeFile = this.app.workspace.getActiveFile();
      const openViews = this.app.workspace.getLeavesOfType("markdown")
        .map((leaf) => leaf.view as unknown as MarkdownFileInfo)
        .filter((candidate) => candidate.file !== null && candidate.editor !== undefined);
      view = openViews.find((candidate) => candidate.file?.path === activeFile?.path) ?? openViews[0];
    }
    if (!view?.file || !view.editor) return { ok: false, reason: "no-editor" };
    if (view.file.path !== snapshot.filePath) return { ok: false, reason: "file-changed" };

    const editor = view.editor;
    if (snapshot.mode === "selection") {
      if (editor.getRange(snapshot.from, snapshot.to) !== snapshot.originalText) {
        return { ok: false, reason: "selection-changed" };
      }
      if (mode === "replace") editor.replaceRange(text, snapshot.from, snapshot.to);
      else editor.replaceRange(`\n\n${text}`, snapshot.to);
      return { ok: true };
    }

    const cursor = editor.getCursor();
    if (cursor.line !== snapshot.cursor.line || cursor.ch !== snapshot.cursor.ch) {
      return { ok: false, reason: "cursor-moved" };
    }
    const prefix = mode === "insert-after" ? `\n\n${text}` : text;
    editor.replaceRange(prefix, snapshot.cursor);
    return { ok: true };
  }
}

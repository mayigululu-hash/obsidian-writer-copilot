import { describe, expect, it } from "vitest";
import type { App, Editor, TFile } from "obsidian";
import { ContextService, surroundingParagraphs } from "../src/context/context-service";

function editor(lines: string[]): Editor {
  return {
    getLine: (line: number) => lines[line] ?? "",
    lineCount: () => lines.length
  } as unknown as Editor;
}

describe("surroundingParagraphs", () => {
  it("extracts the current and previous paragraphs", () => {
    const value = editor(["第一段第一句。", "第一段第二句。", "", "第二段第一句。", "第二段第二句。"]);
    expect(surroundingParagraphs(value, 4)).toEqual({
      current: "第二段第一句。\n第二段第二句。",
      previous: "第一段第一句。\n第一段第二句。"
    });
  });

  it("uses the previous paragraph when the cursor is on an empty line", () => {
    const value = editor(["已有段落。", ""]);
    expect(surroundingParagraphs(value, 1)).toEqual({ current: "", previous: "已有段落。" });
  });
});

describe("ContextService", () => {
  it("keeps the active Markdown note available while focus is in the sidebar", () => {
    const file = { path: "00-我/thinking_log.md", basename: "thinking_log" } as TFile;
    const activeEditor = { getValue: () => "当前页面正文" } as unknown as Editor;
    const app = {
      workspace: {
        activeEditor: undefined,
        getActiveViewOfType: () => null,
        getActiveFile: () => file,
        getLeavesOfType: () => [{ view: { file, editor: activeEditor } }]
      }
    } as unknown as App;

    expect(new ContextService(app).getCurrentNoteChip()).toMatchObject({
      label: "当前页面：thinking_log",
      content: "当前页面正文",
      filePath: "00-我/thinking_log.md",
      followsActiveNote: true
    });
  });
});

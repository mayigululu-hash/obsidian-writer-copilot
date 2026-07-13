import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ MarkdownView: class MarkdownView {} }));

import type { App, EditorPosition } from "obsidian";
import { EditorService } from "../src/editor/editor-service";
import type { EditorSnapshot } from "../src/types";

const from: EditorPosition = { line: 0, ch: 0 };
const to: EditorPosition = { line: 0, ch: 2 };

describe("EditorService", () => {
  let currentText: string;
  let replaced: string | undefined;
  let app: App;

  beforeEach(() => {
    currentText = "原文";
    replaced = undefined;
    app = {
      workspace: {
        getActiveViewOfType: () => ({
          file: { path: "文章.md" },
          editor: {
            getRange: () => currentText,
            getCursor: () => to,
            replaceRange: (text: string) => { replaced = text; }
          }
        })
      }
    } as unknown as App;
  });

  it("replaces a matching selection", () => {
    const service = new EditorService(app);
    expect(service.apply(selectionSnapshot(), "建议版本", "replace")).toEqual({ ok: true });
    expect(replaced).toBe("建议版本");
  });

  it("rejects a stale selection", () => {
    currentText = "已经被修改";
    const service = new EditorService(app);
    expect(service.apply(selectionSnapshot(), "建议版本", "replace")).toEqual({
      ok: false,
      reason: "selection-changed"
    });
    expect(replaced).toBeUndefined();
  });
});

function selectionSnapshot(): EditorSnapshot {
  return {
    filePath: "文章.md",
    mode: "selection",
    from,
    to,
    originalText: "原文",
    cursor: to,
    createdAt: Date.now()
  };
}

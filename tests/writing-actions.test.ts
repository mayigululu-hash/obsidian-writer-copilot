import { describe, expect, it } from "vitest";
import type { ContextBundle } from "../src/types";
import { buildInlinePrompt, INITIAL_WRITING_ACTIONS } from "../src/writing/actions";

describe("inline writing contract", () => {
  it("builds a text-only writing prompt", () => {
    const action = INITIAL_WRITING_ACTIONS.find((item) => item.id === "action-rewrite");
    expect(action).toBeDefined();
    const prompt = buildInlinePrompt(action!, bundle());
    expect(prompt).toContain("可以直接放回文章的正文");
    expect(prompt).toContain("<final>");
    expect(prompt).toContain("选中文字");
  });

});

function bundle(): ContextBundle {
  return {
    chips: [],
    promptContext: "选中文字：\n原文",
    fileTitle: "文章",
    headingPath: [],
    snapshot: {
      filePath: "文章.md",
      mode: "selection",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 2 },
      originalText: "原文",
      cursor: { line: 0, ch: 2 },
      createdAt: Date.now()
    }
  };
}

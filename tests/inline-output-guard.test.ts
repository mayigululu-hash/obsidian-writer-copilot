import { describe, expect, it } from "vitest";
import { finalizeInlineOutput, previewInlineOutput } from "../src/writing/inline-output-guard";

describe("inline output guard", () => {
  it("only exposes text inside the final marker", () => {
    const raw = "<think>English reasoning</think><final>紧接着，Claude Code 被人扒出内置了一段隐藏代码。</final>";
    expect(previewInlineOutput(raw)).toBe("紧接着，Claude Code 被人扒出内置了一段隐藏代码。");
    expect(finalizeInlineOutput(raw)).toEqual({ text: "紧接着，Claude Code 被人扒出内置了一段隐藏代码。", valid: true });
  });

  it("does not flash a split reasoning tag while streaming", () => {
    expect(previewInlineOutput("<")).toBe("");
    expect(previewInlineOutput("<thi")).toBe("");
    expect(previewInlineOutput("<think>The user wants")).toBe("");
    expect(previewInlineOutput("<think>reasoning</think><final>正文")).toBe("正文");
  });

  it("rejects incomplete reasoning and incomplete final output", () => {
    expect(finalizeInlineOutput("<think>reasoning")).toMatchObject({ valid: false, text: "" });
    expect(finalizeInlineOutput("<final>正文")).toMatchObject({ valid: false, text: "" });
  });

  it("accepts plain text fallback but rejects obvious meta commentary", () => {
    expect(finalizeInlineOutput("直接可用的正文")).toEqual({ text: "直接可用的正文", valid: true });
    expect(finalizeInlineOutput("The user wants me to rewrite this.")).toMatchObject({ valid: false });
  });

  it("rejects an unexpectedly large inline result", () => {
    expect(finalizeInlineOutput(`<final>${"正文".repeat(50_001)}</final>`)).toMatchObject({ valid: false });
  });
});

import { describe, expect, it } from "vitest";
import { slashTrigger } from "../src/writing/slash-trigger";

describe("writing slash trigger", () => {
  it("only triggers on an otherwise blank line", () => {
    expect(slashTrigger("/", { line: 3, ch: 1 })).toEqual({ start: { line: 3, ch: 0 }, end: { line: 3, ch: 1 }, query: "" });
    expect(slashTrigger("  /续写", { line: 3, ch: 5 })).toMatchObject({ start: { line: 3, ch: 2 }, query: "续写" });
    expect(slashTrigger("正文 /", { line: 3, ch: 4 })).toBeNull();
    expect(slashTrigger("//", { line: 3, ch: 2 })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { normalizePersistedData } from "../src/settings";

describe("settings migration", () => {
  it("migrates legacy OpenCode data into the native schema", () => {
    const data = normalizePersistedData({
      settings: { attachCurrentNoteByDefault: false },
      vaults: { "/vault": { draft: "草稿", relatedNotes: {} } }
    });
    expect(data.schemaVersion).toBe(5);
    expect(data.settings.attachCurrentNoteByDefault).toBe(true);
    expect(data.settings.profiles).toEqual([]);
    expect(data.settings.models).toEqual([]);
    expect(data.settings.sidebarPosition).toBe("right");
    expect(data.settings.agents).toHaveLength(1);
    expect(data.settings.agents[0]).toMatchObject({ id: "agent-writing-default", name: "写作助手", systemInstruction: "", enabled: true });
    expect(data.settings.defaultAgentID).toBe("agent-writing-default");
    expect(data.settings.writingActions.length).toBeGreaterThan(0);
    expect(data.settings.defaultSelectionActionID).toBe("action-rewrite");
    expect(data.settings.defaultCursorActionID).toBe("action-continue");
    expect(data.vaults["/vault"].currentSessionID).toBeUndefined();
  });

  it("keeps an explicit legacy model preference", () => {
    const data = normalizePersistedData({ schemaVersion: 3, settings: { attachCurrentNoteByDefault: false, sidebarPosition: "left" } });
    expect(data.settings.attachCurrentNoteByDefault).toBe(false);
    expect(data.settings.sidebarPosition).toBe("left");
  });

  it("keeps valid agents and repairs an unavailable default", () => {
    const data = normalizePersistedData({
      schemaVersion: 4,
      settings: {
        defaultAgentID: "missing",
        agents: [{ id: "review", name: "审稿", enabled: true, systemInstruction: "严格审稿", createdAt: 10, updatedAt: 11 }]
      }
    });
    expect(data.settings.agents).toHaveLength(1);
    expect(data.settings.defaultAgentID).toBe("review");
    expect(data.settings.agents[0].systemInstruction).toBe("严格审稿");
  });

  it("preserves an intentionally empty action registry", () => {
    const data = normalizePersistedData({
      schemaVersion: 5,
      settings: { writingActions: [], defaultSelectionActionID: "action-rewrite", defaultCursorActionID: "action-continue" }
    });
    expect(data.settings.writingActions).toEqual([]);
    expect(data.settings.defaultSelectionActionID).toBeUndefined();
    expect(data.settings.defaultCursorActionID).toBeUndefined();
  });
});

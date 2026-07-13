import { describe, expect, it, vi } from "vitest";
import { NativeModelGateway } from "../src/ai/model-gateway";
import type { GenerationRequest, ModelOption, ProviderProfile } from "../src/types";

describe("NativeModelGateway", () => {
  it("streams OpenAI-compatible text through the normalized callback", async () => {
    const fetcher = vi.fn(async () => sse([
      { choices: [{ delta: { content: "你好" } }] },
      { choices: [{ delta: { content: "，世界" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }
    ]));
    const gateway = new NativeModelGateway(fetcher);
    const partials: string[] = [];
    const result = await gateway.generate(request("openai-compatible", (text) => partials.push(text)));
    expect(result).toEqual({ text: "你好，世界", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 4 } });
    expect(partials).toEqual(["你好", "你好，世界"]);
    expect(fetcher).toHaveBeenCalledWith("https://example.com/v1/chat/completions", expect.objectContaining({ method: "POST" }));
  });

  it("normalizes Anthropic and Gemini streaming formats", async () => {
    const anthropic = new NativeModelGateway(async () => sse([
      { type: "content_block_delta", delta: { type: "thinking_delta", text: "hidden" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "A" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }
    ]));
    expect((await anthropic.generate(request("anthropic"))).text).toBe("A");

    const gemini = new NativeModelGateway(async () => sse([
      { candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "B" }] } }] },
      { candidates: [{ content: { parts: [{ text: "C" }] }, finishReason: "STOP" }] }
    ]));
    expect(await gemini.generate(request("gemini"))).toMatchObject({ text: "BC", finishReason: "STOP" });
  });

  it("supports keyless local OpenAI-compatible model discovery", async () => {
    const gateway = new NativeModelGateway(async (_input, init) => {
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return Response.json({ data: [{ id: "local-model" }] });
    });
    const models = await gateway.listModels(profile("openai-compatible"), "");
    expect(models).toEqual([{ id: "local-model", label: "local-model" }]);
  });

  it("returns a classified authentication error", async () => {
    const gateway = new NativeModelGateway(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    await expect(gateway.generate(request("openai-compatible"))).rejects.toMatchObject({ code: "auth", status: 401 });
  });
});

function request(kind: ProviderProfile["kind"], onText?: GenerationRequest["onText"]): GenerationRequest {
  return {
    profile: profile(kind),
    model: model(),
    apiKey: "secret",
    messages: [{ role: "user", content: "hello" }],
    onText
  };
}

function profile(kind: ProviderProfile["kind"]): ProviderProfile {
  return { id: "profile", kind, name: "Provider", baseURL: "https://example.com/v1", secretID: "secret", enabled: true };
}

function model(): ModelOption {
  return { id: "profile:model", profileID: "profile", providerModelID: "model", label: "Model", enabled: true };
}

function sse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

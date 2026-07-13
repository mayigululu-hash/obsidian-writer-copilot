import type {
  GenerationRequest,
  GenerationResult,
  GatewayMessage,
  ModelGateway,
  ProviderProfile
} from "../types";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly code: "missing-secret" | "auth" | "rate-limit" | "timeout" | "network" | "invalid-response" | "unknown",
    readonly status?: number
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export class NativeModelGateway implements ModelGateway {
  constructor(private readonly fetchImpl: FetchLike = desktopFetch()) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (request.profile.kind !== "openai-compatible" && !request.apiKey.trim()) {
      throw new ProviderRequestError("当前模型未配置 API Key", "missing-secret");
    }
    if (request.profile.kind === "anthropic") return this.generateAnthropic(request);
    if (request.profile.kind === "gemini") return this.generateGemini(request);
    return this.generateOpenAI(request);
  }

  async listModels(profile: ProviderProfile, apiKey: string, signal?: AbortSignal): Promise<Array<{ id: string; label: string }>> {
    if (profile.kind !== "openai-compatible" && !apiKey.trim()) throw new ProviderRequestError("请先配置 API Key", "missing-secret");
    const headers: Record<string, string> = { Accept: "application/json" };
    let url = joinURL(profile.baseURL, "models");
    if (profile.kind === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (profile.kind === "gemini") {
      headers["x-goog-api-key"] = apiKey;
    } else {
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await this.fetch(url, { headers, signal });
    const payload = await parseJSON(response);
    if (profile.kind === "gemini") {
      return array(payload.models)
        .filter((item) => stringArray(item.supportedGenerationMethods).includes("generateContent"))
        .map((item) => ({ id: text(item.name).replace(/^models\//, ""), label: text(item.displayName) || text(item.name) }))
        .filter(hasModelID);
    }
    return array(payload.data)
      .map((item) => ({ id: text(item.id), label: text(item.display_name) || text(item.displayName) || text(item.id) }))
      .filter(hasModelID);
  }

  private async generateOpenAI(request: GenerationRequest): Promise<GenerationResult> {
    const response = await this.fetch(joinURL(request.profile.baseURL, "chat/completions"), {
      method: "POST",
      headers: {
        ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}),
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({ model: request.model.providerModelID, messages: request.messages, stream: true, stream_options: { include_usage: true } }),
      signal: request.signal
    });
    let textValue = "";
    let finishReason: string | undefined;
    let usage: GenerationResult["usage"];
    await readSSE(response, (data) => {
      if (data === "[DONE]") return;
      const event = safeJSON(data);
      const delta = text(array(event.choices)[0]?.delta && record(array(event.choices)[0]?.delta).content);
      if (delta) {
        textValue += delta;
        request.onText?.(textValue, delta);
      }
      finishReason = text(array(event.choices)[0]?.finish_reason) || finishReason;
      const rawUsage = record(event.usage);
      if (Object.keys(rawUsage).length) usage = { inputTokens: number(rawUsage.prompt_tokens), outputTokens: number(rawUsage.completion_tokens) };
    });
    return { text: textValue, finishReason, usage };
  }

  private async generateAnthropic(request: GenerationRequest): Promise<GenerationResult> {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages = request.messages.filter((message) => message.role !== "system").map(({ role, content }) => ({ role, content }));
    const response = await this.fetch(joinURL(request.profile.baseURL, "messages"), {
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({ model: request.model.providerModelID, system, messages, max_tokens: 8192, stream: true }),
      signal: request.signal
    });
    let textValue = "";
    let finishReason: string | undefined;
    let usage: GenerationResult["usage"];
    await readSSE(response, (data) => {
      const event = safeJSON(data);
      const rawDelta = record(event.delta);
      const delta = rawDelta.type === "thinking_delta" ? "" : text(rawDelta.text);
      if (delta) {
        textValue += delta;
        request.onText?.(textValue, delta);
      }
      finishReason = text(record(event.delta).stop_reason) || finishReason;
      const rawUsage = record(event.usage);
      if (Object.keys(rawUsage).length) {
        usage = {
          inputTokens: number(rawUsage.input_tokens) ?? usage?.inputTokens,
          outputTokens: number(rawUsage.output_tokens) ?? usage?.outputTokens
        };
      }
    });
    return { text: textValue, finishReason, usage };
  }

  private async generateGemini(request: GenerationRequest): Promise<GenerationResult> {
    const model = request.model.providerModelID.replace(/^models\//, "");
    let url = joinURL(request.profile.baseURL, `models/${encodeURIComponent(model)}:streamGenerateContent`);
    url = withQuery(url, "alt", "sse");
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents = request.messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
    const response = await this.fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": request.apiKey, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents }),
      signal: request.signal
    });
    let textValue = "";
    let finishReason: string | undefined;
    let usage: GenerationResult["usage"];
    await readSSE(response, (data) => {
      const event = safeJSON(data);
      const candidate = record(array(event.candidates)[0]);
      const parts = array(record(candidate.content).parts);
      const delta = parts.filter((part) => part.thought !== true).map((part) => text(part.text)).join("");
      if (delta) {
        textValue += delta;
        request.onText?.(textValue, delta);
      }
      finishReason = text(candidate.finishReason) || finishReason;
      const rawUsage = record(event.usageMetadata);
      if (Object.keys(rawUsage).length) usage = { inputTokens: number(rawUsage.promptTokenCount), outputTokens: number(rawUsage.candidatesTokenCount) };
    });
    return { text: textValue, finishReason, usage };
  }

  private async fetch(input: string, init: RequestInit): Promise<Response> {
    try {
      const response = await this.fetchImpl(input, init);
      if (!response.ok) throw await responseError(response);
      return response;
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ProviderRequestError(`无法连接模型服务：${errorMessage(error)}`, "network");
    }
  }
}

function desktopFetch(): FetchLike {
  try {
    const electron = require("electron") as { net?: { fetch?: FetchLike } };
    if (electron.net?.fetch) return electron.net.fetch.bind(electron.net);
  } catch {
    // Electron does not expose net in every renderer build. Node HTTP remains CORS-free.
  }
  return nodeFetch;
}

function nodeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new ProviderRequestError(`不支持的模型服务协议：${url.protocol}`, "network"));
      return;
    }
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, { method: init.method ?? "GET", headers }, (response) => {
      resolve(nodeResponse(response));
    });
    const abort = () => request.destroy(new DOMException("请求已取消", "AbortError"));
    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => {
      init.signal?.removeEventListener("abort", abort);
      reject(init.signal?.aborted ? new DOMException("请求已取消", "AbortError") : error);
    });
    request.on("close", () => init.signal?.removeEventListener("abort", abort));
    if (typeof init.body === "string" || init.body instanceof Uint8Array) request.write(init.body);
    else if (init.body !== undefined && init.body !== null) {
      request.destroy(new Error("当前网络层仅支持文本请求体"));
      return;
    }
    request.end();
  });
}

function nodeResponse(response: IncomingMessage): Response {
  const status = response.statusCode ?? 500;
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, String(value));
  }
  const noBody = status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
  if (noBody) return new Response(null, { status, statusText: response.statusMessage, headers });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      response.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      response.on("end", () => controller.close());
      response.on("error", (error) => controller.error(error));
    },
    cancel() { response.destroy(); }
  });
  return new Response(body, { status, statusText: response.statusMessage, headers });
}

async function readSSE(response: Response, onData: (data: string) => void): Promise<void> {
  if (!response.body) throw new ProviderRequestError("模型服务未返回可读内容", "invalid-response", response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const normalized = buffer.replace(/\r\n/g, "\n");
    const events = normalized.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) onData(data);
    }
    if (done) break;
  }
  const tail = buffer.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (tail) onData(tail);
}

async function responseError(response: Response): Promise<ProviderRequestError> {
  const body = await response.text().catch(() => "");
  const parsed = safeJSON(body);
  const detail = text(record(parsed.error).message) || text(parsed.message) || body.slice(0, 300) || response.statusText;
  const code = response.status === 401 || response.status === 403 ? "auth" : response.status === 429 ? "rate-limit" : "unknown";
  return new ProviderRequestError(`模型服务返回 HTTP ${response.status}：${detail}`, code, response.status);
}

async function parseJSON(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  const parsed = safeJSON(raw);
  if (!Object.keys(parsed).length && raw.trim()) throw new ProviderRequestError("模型服务返回了无法解析的数据", "invalid-response", response.status);
  return parsed;
}

function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function withQuery(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function safeJSON(value: string): Record<string, unknown> {
  try { return record(JSON.parse(value) as unknown); } catch { return {}; }
}

function array(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function hasModelID(value: { id: string; label: string }): boolean {
  return Boolean(value.id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}

export function toGatewayMessages(system: string, history: Array<{ role: "user" | "assistant"; text: string }>): GatewayMessage[] {
  return [
    ...(system.trim() ? [{ role: "system" as const, content: system.trim() }] : []),
    ...history.map((message) => ({ role: message.role, content: message.text }))
  ];
}

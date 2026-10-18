// Regression: the OpenAI passthrough stream must never forward a concealed
// fingerprint alias (read_client / shell_client) to the client. Reproduces the
// live symptom `unknown tool "read_client"`: the request-scoped rename map is not
// passed to this builder, so restoreToolNames() alone cannot cover this path.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

async function collectPassthrough(chunks) {
  const providerResponse = new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }));

  const transform = createPassthroughStreamWithLogger(
    null, null, "oc/deepseek-v4.1-flash-free", "test-connection",
    { messages: [] }, async () => {}, "test-key",
  );
  const reader = providerResponse.body.pipeThrough(transform).getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(new TextDecoder().decode(value));
  }
  return parts.join("");
}

const aliasChunk = (name) =>
  `data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"finish_reason":null,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"${name}","arguments":"{}"}}]}}]}\n\n`;

describe("openai passthrough: fingerprint alias restore", () => {
  it("restores read_client in a complete data line", async () => {
    const out = await collectPassthrough([aliasChunk("read_client")]);
    expect(out).not.toContain('"name":"read_client"');
    expect(out).toContain('"name":"read"');
  });

  it("restores a numbered alias", async () => {
    const out = await collectPassthrough([aliasChunk("read_client2")]);
    expect(out).not.toContain('"name":"read_client2"');
    expect(out).toContain('"name":"read"');
  });

  it("restores shell_client in a complete data line", async () => {
    const out = await collectPassthrough([aliasChunk("shell_client")]);
    expect(out).not.toContain('"name":"shell_client"');
    expect(out).toContain('"name":"shell"');
  });

  it("restores an alias in the unterminated tail forwarded at flush", async () => {
    // The final chunk ends without a newline, so the line reaches the client from
    // the flush tail, where only the raw text is available.
    const line = aliasChunk("read_client");
    const out = await collectPassthrough([line.slice(0, -2)]);
    expect(out).not.toContain('"name":"read_client"');
    expect(out).toContain('"name":"read"');
  });

  it("leaves non-alias tool names untouched", async () => {
    const out = await collectPassthrough([aliasChunk("bash")]);
    expect(out).toContain('"name":"bash"');
    expect(out).not.toContain("read_client");
  });
});

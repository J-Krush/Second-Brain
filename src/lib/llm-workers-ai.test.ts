import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deltaOf, sseDeltas, workersAi } from "./llm-workers-ai";

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of stream) out.push(d);
  return out;
}

describe("deltaOf", () => {
  it("reads the three shapes Workers AI emits", () => {
    expect(deltaOf({ response: "a" })).toBe("a");
    expect(deltaOf({ choices: [{ delta: { content: "b" } }] })).toBe("b");
    expect(deltaOf({ type: "response.output_text.delta", delta: "c" })).toBe("c");
  });

  it("drops reasoning deltas and junk", () => {
    expect(deltaOf({ type: "response.reasoning_text.delta", delta: "thinking" })).toBe("");
    expect(deltaOf({ response: null, usage: {} })).toBe("");
    expect(deltaOf("nope")).toBe("");
  });
});

describe("sseDeltas", () => {
  it("joins events split across chunks and stops at [DONE]", async () => {
    const stream = body([
      'data: {"response":"Hel',
      'lo"}\n\ndata: {"response":" world"}\n\n',
      "data: [DONE]\n\ndata: {\"response\":\"ignored\"}\n\n",
    ]);
    expect(await collect(sseDeltas(stream))).toEqual(["Hello", " world"]);
  });

  it("skips comments, blank lines and unparsable payloads", async () => {
    const stream = body([": keepalive\n\ndata: not json\n\ndata: {\"response\":\"ok\"}\n\n"]);
    expect(await collect(sseDeltas(stream))).toEqual(["ok"]);
  });
});

describe("workersAi provider over REST", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CF_ACCOUNT_ID", "acct");
    vi.stubEnv("CF_AI_TOKEN", "tok");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts the chat input with stream on and yields the deltas", async () => {
    fetchMock.mockResolvedValue(new Response(body(['data: {"response":"hi"}\n\ndata: [DONE]\n\n']), { status: 200 }));
    const p = workersAi("@cf/openai/gpt-oss-120b");
    const out = await collect(
      p.generate({ messages: [{ role: "user", content: "q" }], maxTokens: 99, temperature: 0.3 }),
    );
    expect(out).toEqual(["hi"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/openai/gpt-oss-120b");
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [{ role: "user", content: "q" }],
      max_tokens: 99,
      temperature: 0.3,
      stream: true,
    });
  });

  it("surfaces the API's error message on a failed request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, errors: [{ message: "No such model" }] }), { status: 400 }),
    );
    const p = workersAi("@cf/nope");
    await expect(collect(p.generate({ messages: [], maxTokens: 1, temperature: 0 }))).rejects.toThrow(
      "Workers AI @cf/nope failed: No such model",
    );
  });
});

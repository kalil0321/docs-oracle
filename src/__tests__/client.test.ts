import { describe, it, expect, vi, beforeEach } from "vitest";
import { ask, askStream, createClient } from "../client.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeStreamBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockFetchForAsk(streamLines: string[], html?: string) {
  let callCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      callCount++;
      if (html && callCount === 1) {
        // First call: subdomain detection
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(html),
        });
      }
      // API call
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        body: makeStreamBody(streamLines),
      });
    }),
  );
}

describe("ask", () => {
  it("returns a well-shaped response", async () => {
    const streamLines = [
      'f:{"messageId":"msg-001"}',
      '0:"Metronome is a "',
      '0:"billing platform."',
      'a:{"result":{"type":"search","results":[{"content":"Metronome helps...","path":"/overview","metadata":{"title":"Overview","href":"/overview"}}]}}',
      'e:{"usage":{"promptTokens":50,"completionTokens":20}}',
    ];

    mockFetchForAsk(
      streamLines,
      '<script>{"subdomain":"metronome-abc"}</script>',
    );

    const response = await ask("https://docs.metronome.com", "What is Metronome?");

    expect(response.content).toBe("Metronome is a billing platform.");
    expect(response.messageId).toBe("msg-001");
    expect(response.searchResults).toHaveLength(1);
    expect(response.searchResults[0].title).toBe("Overview");
    expect(response.searchResults[0].href).toBe(
      "https://docs.metronome.com/overview",
    );
    expect(response.usage).toEqual({
      promptTokens: 50,
      completionTokens: 20,
    });
  });

  it("uses provided subdomain and skips detection", async () => {
    const streamLines = [
      'f:{"messageId":"msg-002"}',
      '0:"Answer"',
    ];

    mockFetchForAsk(streamLines);

    await ask("https://docs.example.com", "Question", {
      subdomain: "my-sub",
    });

    // Should only have 1 fetch call (the API call), no subdomain detection
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://leaves.mintlify.com/api/assistant/my-sub/message",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("parses and strips suggestions block", async () => {
    const streamLines = [
      'f:{"messageId":"msg-003"}',
      '0:"Some answer\\n\\n```suggestions\\n(Getting Started)[/start]\\n(API Ref)[/api]\\n```"',
    ];

    mockFetchForAsk(streamLines);

    const response = await ask("https://docs.example.com", "Help", {
      subdomain: "test",
    });

    expect(response.content).toBe("Some answer");
    expect(response.suggestions).toEqual(["/start", "/api"]);
  });
});

describe("askStream", () => {
  it("yields text events and a done event", async () => {
    const streamLines = [
      'f:{"messageId":"msg-s1"}',
      '0:"Hello "',
      '0:"world"',
      'a:{"result":{"type":"search","results":[{"content":"c","path":"/p","metadata":{"title":"T","href":"/p"}}]}}',
      'e:{"usage":{"promptTokens":10,"completionTokens":5}}',
    ];

    mockFetchForAsk(streamLines);

    const events = [];
    for await (const event of askStream("https://docs.example.com", "Hi", {
      subdomain: "test",
    })) {
      events.push(event);
    }

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0]).toEqual({ type: "text", text: "Hello " });
    expect(textEvents[1]).toEqual({ type: "text", text: "world" });

    const searchEvents = events.filter((e) => e.type === "searchResults");
    expect(searchEvents).toHaveLength(1);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    if (doneEvent?.type === "done") {
      expect(doneEvent.response.content).toBe("Hello world");
      expect(doneEvent.response.messageId).toBe("msg-s1");
      expect(doneEvent.response.searchResults).toHaveLength(1);
      expect(doneEvent.response.searchResults[0].href).toBe(
        "https://docs.example.com/p",
      );
    }
  });
});

describe("createClient", () => {
  it("maintains message history across calls", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve('<script>{"subdomain":"test-sub"}</script>'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          body: makeStreamBody([
            'f:{"messageId":"msg-' + callCount + '"}',
            '0:"Answer ' + callCount + '"',
          ]),
        });
      }),
    );

    const client = createClient("https://docs.example.com");

    await client.ask("First question");
    expect(client.messages).toHaveLength(2); // user + assistant

    await client.ask("Second question");
    expect(client.messages).toHaveLength(4); // 2 user + 2 assistant

    client.clearHistory();
    expect(client.messages).toHaveLength(0);
  });

  it("supports askStream and maintains history", async () => {
    mockFetchForAsk([
      'f:{"messageId":"msg-cs1"}',
      '0:"Streamed answer"',
    ]);

    const client = createClient("https://docs.example.com", {
      subdomain: "test",
    });

    const events = [];
    for await (const event of client.askStream("Stream question")) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(client.messages).toHaveLength(2); // user + assistant
  });
});

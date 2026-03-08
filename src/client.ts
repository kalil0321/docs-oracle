import { detectSubdomain } from "./subdomain.js";
import { processStreamResponse } from "./stream-parser.js";
import type {
  DocsOracleOptions,
  DocsOracleResponse,
  Message,
  SearchResult,
  StreamEvent,
} from "./types.js";

const API_BASE = "https://leaves.mintlify.com/api/assistant";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function makeMessage(role: "user" | "assistant", content: string): Message {
  return {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    createdAt: new Date().toISOString(),
    role,
    content,
    parts: [{ type: "text", text: content }],
  };
}

function buildRequestBody(
  subdomain: string,
  messages: Message[],
  options: DocsOracleOptions,
) {
  const body: Record<string, unknown> = {
    id: subdomain,
    messages,
    fp: subdomain,
    filter: {
      groups: options.filterGroups ?? ["*"],
    },
    currentPath: options.currentPath ?? "/",
  };

  if (options.filterVersion) {
    (body.filter as Record<string, unknown>).version = options.filterVersion;
  }

  return body;
}

function parseSuggestions(content: string): {
  cleanContent: string;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  const match = content.match(/```suggestions\n([\s\S]*?)\n```/);

  if (match) {
    for (const line of match[1].trim().split("\n")) {
      const titleMatch = line.trim().match(/\(([^)]+)\)\[([^\]]+)\]/);
      if (titleMatch) {
        suggestions.push(titleMatch[2]);
      }
    }
    const cleanContent = content
      .replace(/\n*```suggestions\n[\s\S]*?\n```\n*/g, "")
      .trim();
    return { cleanContent, suggestions };
  }

  return { cleanContent: content.trim(), suggestions };
}

function resolveSearchResultHrefs(
  results: SearchResult[],
  docsUrl: string,
): SearchResult[] {
  return results.map((r) => ({
    ...r,
    href: r.href.startsWith("/") ? `${docsUrl}${r.href}` : r.href,
  }));
}

async function postStream(
  subdomain: string,
  messages: Message[],
  docsUrl: string,
  options: DocsOracleOptions,
): Promise<ReadableStream<Uint8Array>> {
  const url = `${API_BASE}/${subdomain}/message`;
  const body = buildRequestBody(subdomain, messages, options);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/json",
      "Origin": docsUrl,
      "Referer": `${docsUrl}/`,
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Mintlify API error (${response.status}): ${response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error("No response body received from Mintlify API");
  }

  return response.body;
}

function extractSearchResults(data: unknown): SearchResult[] {
  const result = (data as Record<string, Record<string, unknown>>).result;
  if (result?.type !== "search") return [];
  const results = result.results as Array<Record<string, unknown>>;
  return (results ?? []).map((r) => {
    const metadata = (r.metadata ?? {}) as Record<string, string>;
    return {
      content: (r.content as string) ?? "",
      path: (r.path as string) ?? "",
      title: metadata.title ?? "",
      href: metadata.href ?? "",
    };
  });
}

async function collectStream(
  body: ReadableStream<Uint8Array>,
  docsUrl: string,
): Promise<DocsOracleResponse> {
  const textParts: string[] = [];
  let messageId = "";
  let searchResults: SearchResult[] = [];
  let usage: Record<string, number> | null = null;

  for await (const { type, data } of processStreamResponse(body)) {
    if (type === "f" && data && typeof data === "object") {
      messageId = (data as Record<string, string>).messageId ?? "";
    } else if (type === "0" && data) {
      textParts.push(data as string);
    } else if (type === "a" && data && typeof data === "object") {
      searchResults.push(...extractSearchResults(data));
    } else if (type === "e" && data && typeof data === "object") {
      usage =
        ((data as Record<string, unknown>).usage as Record<string, number>) ??
        null;
    }
  }

  const rawContent = textParts.join("");
  const { cleanContent, suggestions } = parseSuggestions(rawContent);
  searchResults = resolveSearchResultHrefs(searchResults, docsUrl);

  return { content: cleanContent, messageId, searchResults, suggestions, usage };
}

async function* iterateStream(
  body: ReadableStream<Uint8Array>,
  docsUrl: string,
): AsyncGenerator<StreamEvent> {
  const textParts: string[] = [];
  let messageId = "";
  let searchResults: SearchResult[] = [];
  let usage: Record<string, number> | null = null;

  for await (const { type, data } of processStreamResponse(body)) {
    if (type === "f" && data && typeof data === "object") {
      messageId = (data as Record<string, string>).messageId ?? "";
    } else if (type === "0" && data) {
      textParts.push(data as string);
      yield { type: "text", text: data as string };
    } else if (type === "a" && data && typeof data === "object") {
      const results = resolveSearchResultHrefs(extractSearchResults(data), docsUrl);
      searchResults.push(...results);
      if (results.length) yield { type: "searchResults", results };
    } else if (type === "e" && data && typeof data === "object") {
      usage =
        ((data as Record<string, unknown>).usage as Record<string, number>) ??
        null;
    }
  }

  const rawContent = textParts.join("");
  const { cleanContent, suggestions } = parseSuggestions(rawContent);

  yield {
    type: "done",
    response: { content: cleanContent, messageId, searchResults, suggestions, usage },
  };
}

async function resolveSubdomain(
  docsUrl: string,
  options: DocsOracleOptions,
): Promise<string> {
  return options.subdomain ?? (await detectSubdomain(docsUrl));
}

export async function ask(
  docsUrl: string,
  question: string,
  options: DocsOracleOptions = {},
): Promise<DocsOracleResponse> {
  const url = docsUrl.replace(/\/+$/, "");
  const subdomain = await resolveSubdomain(url, options);
  const messages = [makeMessage("user", question)];
  const body = await postStream(subdomain, messages, url, options);
  return collectStream(body, url);
}

export async function* askStream(
  docsUrl: string,
  question: string,
  options: DocsOracleOptions = {},
): AsyncGenerator<StreamEvent> {
  const url = docsUrl.replace(/\/+$/, "");
  const subdomain = await resolveSubdomain(url, options);
  const messages = [makeMessage("user", question)];
  const body = await postStream(subdomain, messages, url, options);
  yield* iterateStream(body, url);
}

export function createClient(docsUrl: string, options: DocsOracleOptions = {}) {
  const url = docsUrl.replace(/\/+$/, "");
  let subdomain: string | undefined = options.subdomain;
  const messages: Message[] = [];

  async function ensureSubdomain(): Promise<string> {
    if (!subdomain) {
      subdomain = await detectSubdomain(url);
    }
    return subdomain;
  }

  return {
    get messages() {
      return [...messages];
    },

    async ask(question: string): Promise<DocsOracleResponse> {
      const sub = await ensureSubdomain();
      messages.push(makeMessage("user", question));
      const body = await postStream(sub, messages, url, options);
      const response = await collectStream(body, url);
      messages.push(makeMessage("assistant", response.content));
      return response;
    },

    async *askStream(question: string): AsyncGenerator<StreamEvent> {
      const sub = await ensureSubdomain();
      messages.push(makeMessage("user", question));
      const body = await postStream(sub, messages, url, options);
      let finalResponse: DocsOracleResponse | undefined;
      for await (const event of iterateStream(body, url)) {
        if (event.type === "done") finalResponse = event.response;
        yield event;
      }
      if (finalResponse) {
        messages.push(makeMessage("assistant", finalResponse.content));
      }
    },

    clearHistory() {
      messages.length = 0;
    },
  };
}

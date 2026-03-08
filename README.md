<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kalil0321/docs-oracle/main/.github/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/kalil0321/docs-oracle/main/.github/banner-light.svg">
    <img alt="docs-oracle" src="https://raw.githubusercontent.com/kalil0321/docs-oracle/main/.github/banner-dark.svg" width="600">
  </picture>
</p>

<p align="center">
  <strong>Query any docs powered by Mintlify</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/docs-oracle"><img src="https://img.shields.io/npm/v/docs-oracle?color=22c55e&label=npm" alt="npm"></a>
  <a href="https://github.com/kalil0321/docs-oracle"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-22c55e" alt="node"></a>
  <a href="https://github.com/kalil0321/docs-oracle/actions/workflows/ci.yml"><img src="https://github.com/kalil0321/docs-oracle/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/kalil0321/docs-oracle"><img src="https://raw.githubusercontent.com/kalil0321/docs-oracle/main/.github/badges/coverage.svg" alt="coverage"></a>
</p>

---

CLI + TypeScript library to ask questions to any documentation site powered by [Mintlify](https://mintlify.com). Uses Mintlify's AI assistant under the hood — auto-detects the subdomain, streams the response, and returns structured answers with sources.

```
  ◆ docs-oracle  by kalil0321
  query any docs powered by mintlify

  ✓ Done.

  ── Answer ──────────────────────────────────────────────

  Metronome is a billing platform that transforms your
  customers' usage into precise, tailored invoices...

  ── Sources ─────────────────────────────────────────────

  ◆ How Metronome works
    https://docs.metronome.com/guides/get-started/how-metronome-works
```

## Install

```bash
npm install docs-oracle
```

## Usage

### As a library

```typescript
import { ask } from "docs-oracle";

const response = await ask(
  "https://docs.metronome.com",
  "What is Metronome?"
);

console.log(response.content);
console.log(response.searchResults); // sources with titles + URLs
console.log(response.suggestions);  // follow-up paths
```

### Streaming

```typescript
import { askStream } from "docs-oracle";

for await (const event of askStream("https://docs.notte.cc", "What is Notte?")) {
  if (event.type === "text") {
    process.stdout.write(event.text);
  } else if (event.type === "done") {
    console.log("\n\nSources:", event.response.searchResults);
  }
}
```

### Stateful client (multi-turn)

```typescript
import { createClient } from "docs-oracle";

const client = createClient("https://docs.metronome.com");

const r1 = await client.ask("What is Metronome?");
const r2 = await client.ask("How do I set up billing?"); // has conversation context

client.clearHistory();
```

### CLI

```bash
# One-shot
npx docs-oracle "https://docs.metronome.com" "What is Metronome?"

# JSON output
npx docs-oracle "https://docs.metronome.com" "What is Metronome?" --json

# Interactive
npx docs-oracle
```

## API

### `ask(docsUrl, question, options?)`

Returns `Promise<DocsOracleResponse>`.

### `askStream(docsUrl, question, options?)`

Returns `AsyncGenerator<StreamEvent>` yielding `text`, `searchResults`, and `done` events.

### `createClient(docsUrl, options?)`

Returns a stateful client with `ask()`, `askStream()`, `messages`, and `clearHistory()`.

### Options

| Option | Type | Description |
|---|---|---|
| `subdomain` | `string` | Skip auto-detection, use this Mintlify subdomain directly |
| `filterGroups` | `string[]` | Content groups to filter (default: `["*"]`) |
| `filterVersion` | `string` | Version filter for versioned docs |
| `currentPath` | `string` | Current page path for context (default: `"/"`) |

### Response shape

```typescript
interface DocsOracleResponse {
  content: string;           // Markdown answer
  messageId: string;
  searchResults: SearchResult[]; // { content, path, title, href }
  suggestions: string[];     // Follow-up paths
  usage: Record<string, number> | null;
}
```

## Disclaimer

> **This package is not affiliated with, endorsed by, or associated with [Mintlify](https://mintlify.com) in any way.**
>
> `docs-oracle` interacts with Mintlify's publicly accessible AI assistant endpoints — the same ones used by the chat widget embedded on documentation sites. No authentication is bypassed, no private data is accessed, and no rate limiting is circumvented.
>
> This is an independent open-source project built for developer convenience. Use it responsibly and in accordance with the terms of service of the documentation sites you query. The authors assume no liability for misuse.

## License

MIT — see [LICENSE](./LICENSE) for details.

---

<p align="center">
  <sub>Built by <a href="https://github.com/kalil0321"><strong>kalil0321</strong></a></sub>
</p>

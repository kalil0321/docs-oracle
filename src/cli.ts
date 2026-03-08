#!/usr/bin/env node

import { text, isCancel, cancel } from "@clack/prompts";
import chalk from "chalk";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { askStream } from "./client.js";
import type { DocsOracleResponse } from "./types.js";

const g = chalk.green;
const gB = chalk.greenBright;
const dim = chalk.dim;
const bold = chalk.bold;

const md = new Marked(
  markedTerminal({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 100),
    tab: 2,
  }) as unknown as Parameters<typeof Marked.prototype.use>[0],
);

function fixInlineMarkdown(text: string): string {
  // marked-terminal doesn't render inline formatting inside list items
  // Post-process remaining **bold** and *italic* markers
  return text
    .replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => bold(t))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, t: string) => chalk.italic(t))
    .replace(/`([^`]+)`/g, (_m, t: string) => chalk.cyan(t));
}

function renderMarkdown(content: string): string {
  const rendered = (md.parse(content) as string).trimEnd();
  return fixInlineMarkdown(rendered);
}

function banner() {
  console.log();
  console.log(`  ${gB("◆")} ${bold("docs-oracle")}  ${dim("by")} ${bold("kalil0321")}`);
  console.log(`  ${dim("query any docs powered by mintlify")}`);
  console.log();
}

function separator(label: string) {
  const cols = Math.min(process.stdout.columns || 60, 60);
  const line = dim("─".repeat(Math.max(cols - label.length - 4, 10)));
  return `  ${dim("──")} ${gB(label)} ${line}`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function createSpinner() {
  let frame = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentMsg = "";

  return {
    start(msg: string) {
      currentMsg = msg;
      interval = setInterval(() => {
        const f = g(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
        process.stderr.write(`\r  ${f} ${dim(currentMsg)}`);
        frame++;
      }, 80);
    },
    update(msg: string) {
      currentMsg = msg;
    },
    stop(msg?: string) {
      if (interval) clearInterval(interval);
      process.stderr.write(`\r${" ".repeat(process.stdout.columns || 60)}\r`);
      if (msg) {
        console.error(`  ${g("✓")} ${dim(msg)}`);
      }
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes("--json");
  const positional = args.filter((a) => a !== "--json");

  let url = positional[0];
  let question = positional[1];

  if (!jsonFlag) banner();

  if (!url) {
    const result = await text({
      message: `${g("◆")} Documentation site URL`,
      placeholder: "https://docs.example.com",
    });
    if (isCancel(result)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    url = result;
    console.log();
  }

  if (!question) {
    const result = await text({
      message: `${g("◆")} Your question`,
      placeholder: "How does authentication work?",
    });
    if (isCancel(result)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    question = result;
    console.log();
  }

  const spin = createSpinner();
  spin.start("Connecting to docs...");

  let response: DocsOracleResponse | undefined;
  const textChunks: string[] = [];
  let gotSearchResults = false;

  for await (const event of askStream(url, question)) {
    if (event.type === "searchResults" && !gotSearchResults) {
      gotSearchResults = true;
      spin.update("Generating answer...");
    } else if (event.type === "text") {
      textChunks.push(event.text);
      const words = textChunks.join("").split(/\s+/).length;
      spin.update(`Generating answer... ${dim(`${words} words`)}`);
    } else if (event.type === "done") {
      response = event.response;
    }
  }

  if (!response) {
    spin.stop("No response received.");
    process.exit(1);
  }

  spin.stop("Done.");

  if (jsonFlag) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  // Render markdown answer
  console.log();
  console.log(separator("Answer"));
  console.log();
  console.log(renderMarkdown(response.content));
  console.log();

  // Sources
  if (response.searchResults.length > 0) {
    console.log(separator("Sources"));
    console.log();
    for (const r of response.searchResults) {
      console.log(`  ${g("◆")} ${bold(r.title)}`);
      console.log(`    ${dim(r.href)}`);
    }
    console.log();
  }

  // Suggestions
  if (response.suggestions.length > 0) {
    console.log(separator("Suggested"));
    console.log();
    for (const s of response.suggestions) {
      console.log(`  ${g("→")} ${s}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(`\n  ${chalk.red("✖")} ${err.message}\n`);
  process.exit(1);
});

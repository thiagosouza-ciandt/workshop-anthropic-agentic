// ============================================================
// MCP Docs Client
// ============================================================
// Connects to the MCP filesystem server via stdio (subprocess).
// The server exposes the /docs folder as a set of resources.
//
// What is MCP?
//   Model Context Protocol — a standard way to connect AI agents
//   to external data sources. Instead of writing a custom tool
//   for each data source, you connect to an MCP server and the
//   agent can read, list, and search resources automatically.
//
// Why stdio instead of HTTP?
//   The MCP filesystem server uses stdio transport — it runs as
//   a subprocess and communicates via stdin/stdout. This is the
//   standard transport for local MCP servers.
// ============================================================

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

// Path to the docs folder — resolved relative to the project root
const DOCS_PATH = path.join(process.cwd(), "docs");

// Global client instance — reused across requests to avoid spawning a new
// subprocess on every tool call.
const g = globalThis as any;

async function getMcpClient(): Promise<Client> {
  if (g.__mcp_docs_client) return g.__mcp_docs_client;

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", DOCS_PATH],
  });

  const client = new Client({ name: "corpbank-docs", version: "1.0.0" });
  await client.connect(transport);

  g.__mcp_docs_client = client;
  return client;
}

// ── search_docs tool implementation ──────────────────────────────────────────
// Reads all markdown files in the docs folder and filters by keyword.
// Simple keyword search — good enough for the workshop.
// In production: replace with vector search or MCP sampling.
export async function searchDocs(query: string): Promise<string> {
  try {
    const client = await getMcpClient();

    // List all resources (files) the MCP server exposes
    const { resources } = await client.listResources();

    const results: { file: string; excerpt: string }[] = [];
    const queryLower = query.toLowerCase();

    for (const resource of resources) {
      const { contents } = await client.readResource({ uri: resource.uri });

      for (const content of contents) {
        const c = content as any;
        if (c.type !== "text") continue;
        const text = c.text as string;
        if (text.toLowerCase().includes(queryLower)) {
          // Extract the paragraph containing the keyword
          const lines = text.split("\n");
          const matchingLines = lines.filter((l) =>
            l.toLowerCase().includes(queryLower)
          );
          results.push({
            file: resource.name ?? resource.uri,
            excerpt: matchingLines.slice(0, 3).join(" ").trim(),
          });
        }
      }
    }

    if (results.length === 0) {
      return JSON.stringify({ found: false, message: `No documents found matching: "${query}"` });
    }

    return JSON.stringify({ found: true, results });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

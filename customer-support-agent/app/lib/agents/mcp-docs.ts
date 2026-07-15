// MCP client — connects to the filesystem server (Docker/supergateway) via SSE.
// Reads all docs/ files in full and returns them to Claude for extraction (stuff RAG).
// To swap to another source, change MCP_DOCS_URL and the Docker image — client code stays the same.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_DOCS_URL = process.env.MCP_DOCS_URL ?? "http://localhost:8082/sse";

// Reuse a single client per process to avoid reconnecting on every tool call.
const g = globalThis as any;

async function getMcpClient(): Promise<Client> {
  if (g.__mcp_docs_client) return g.__mcp_docs_client;

  const transport = new SSEClientTransport(new URL(MCP_DOCS_URL));

  const client = new Client({ name: "corpbank-docs", version: "1.0.0" });
  await client.connect(transport);

  g.__mcp_docs_client = client;
  return client;
}

// Returns all docs in full — Claude extracts the answer (stuff RAG, no filtering)
export async function searchDocs(query: string): Promise<string> {
  try {
    const client = await getMcpClient();

    const listResult = await client.callTool({
      name: "list_directory",
      arguments: { path: "/docs" },
    });

    const listing = (listResult.content as any[])[0]?.text as string ?? "";
    const filenames = listing
      .split("\n")
      .filter((l) => l.includes("[FILE]"))
      .map((l) => l.replace("[FILE] ", "").trim());

    const docs: { file: string; content: string }[] = [];

    for (const filename of filenames) {
      const readResult = await client.callTool({
        name: "read_text_file",
        arguments: { path: `/docs/${filename}` },
      });

      const content = (readResult.content as any[])[0]?.text as string ?? "";
      docs.push({ file: filename, content });
    }

    return JSON.stringify({ query, docs });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

# Step 5 — MCP: Internal Document Search (20 min)

## What is MCP?

**Model Context Protocol** is an open standard that lets AI agents connect to external data sources without writing custom code for each one. Instead of building a bespoke API integration, you connect to an MCP server and the agent can read, list, and search resources automatically.

```
Without MCP:  Agent → custom fetch() → your API → data
With MCP:     Agent → MCP client → MCP server → any data source
```

MCP servers exist for: Google Drive, Notion, GitHub, PostgreSQL, Slack, Confluence, and many more. You write the connection once — the agent uses any server.

## What this step adds

A `search_docs` tool that reads the `docs/` folder via an MCP filesystem server. When the customer asks about interest rates, fees, eligibility, or policies, the agent searches the documents and answers with accurate, sourced information instead of making things up.

```
Customer: "What's the interest rate for a $1,000 loan?"
Agent → search_docs("loan interest rate")
     → MCP filesystem server reads docs/loan-policy.md
     → returns matching paragraphs
Agent → answers with real policy data
```

## Files involved

| File | Purpose |
|---|---|
| `docs/loan-policy.md` | Loan rates, eligibility, exception process |
| `docs/credit-limit-policy.md` | Credit limit rules and increase process |
| `docs/faq.md` | Common customer questions |
| `docs/products.md` | Account types, support channels |
| `app/lib/mcp-docs.ts` | MCP client — spawns the filesystem server as a subprocess |

## How it works

The MCP filesystem server runs as a **subprocess** (stdio transport). The Next.js app spawns it once, keeps it alive in `globalThis`, and reuses the connection across requests.

```typescript
// Spawns: npx @modelcontextprotocol/server-filesystem ./docs
const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", DOCS_PATH],
});
const client = new Client({ name: "corpbank-docs", version: "1.0.0" });
await client.connect(transport);
```

Once connected, the agent can call:
- `client.listResources()` — lists all files the server exposes
- `client.readResource({ uri })` — reads a file's content

## Blocks to add

### Block A — Install the SDK (terminal)

```bash
npm install @modelcontextprotocol/sdk
```

### Block B — Create `app/lib/mcp-docs.ts`

Create the MCP client file. Full contents available in `workshop/step5-mcp/mcp-docs.ts`.

### Block C — Add import to `route.ts`

At the top of `app/api/chat/route.ts`, after the existing imports:

```typescript
import { searchDocs } from "@/app/lib/mcp-docs";
```

### Block D — Add the tool definition

Inside the `tools` array in `route.ts`, before `escalate_to_human`:

```typescript
{
  name: "search_docs",
  description:
    "Searches CorpBank's internal policy documents. Use when the customer asks about rates, fees, policies, eligibility, products, or any question that requires official documentation rather than live account data.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Keywords to search, e.g. 'loan interest rate'" },
    },
    required: ["query"],
  },
},
```

### Block E — Add the executor case

Inside `executeTool`, before the `escalate_to_human` case:

```typescript
case "search_docs":
  result = await searchDocs(input.query);
  break;
```

### Block F — Update the system prompt

Add `search_docs` to the tool list in `SYSTEM_PROMPT`:

```
- search_docs: search CorpBank policy documents (rates, fees, eligibility, products)
```

## Test

Send these messages in the chat (no need to identify yourself for policy questions):

```
What's the interest rate for a $1,000 loan?
```
```
How can I increase my credit limit?
```
```
What happens if I miss a payment?
```
```
What accounts does CorpBank offer?
```

**Watch the terminal:**
```
🔧 Tool call: search_docs { query: 'loan interest rate' }
✅ Tool result: search_docs {"found":true,"results":[{"file":"loan-policy.md","excerpt":"$501 – $2,000 | Up to 24 months | 11.0%"}]}
```

## Discussion points

- **MCP vs direct API:** MCP standardizes the interface. If tomorrow you switch from a local filesystem to Notion or Confluence, you only change the server — the agent code stays identical.

- **Why stdio instead of HTTP?** Local MCP servers use stdio (stdin/stdout) for simplicity. Remote MCP servers (e.g., a shared company knowledge base) use HTTP with SSE transport — same SDK, different transport.

- **Why keyword search?** Good enough for the workshop. In production, replace `searchDocs` with a vector similarity search (embeddings) so the agent finds relevant content even when the exact keywords don't match.

- **What else can MCP do?** Beyond reading files, MCP servers can expose tools (callable functions) and prompts (pre-written templates). The filesystem server only exposes resources (readable files).

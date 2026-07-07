# CI&T × Anthropic — Multi-Agent Workshop
## CorpBank Customer Support Agent

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Schedule](#2-schedule)
3. [Architecture](#3-architecture)
4. [What is a Router Agent?](#4-what-is-a-router-agent)
5. [Tools](#5-tools)
6. [The Agentic Loop](#6-the-agentic-loop)
7. [Escalate to Human (Human-in-the-Loop)](#7-escalate-to-human-human-in-the-loop)
8. [MCP — Internal Document Search](#8-mcp--internal-document-search)
9. [Prompt Attack Prevention](#9-prompt-attack-prevention)
10. [Running the Project](#10-running-the-project)
11. [Database & API Contract](#11-database--api-contract)
12. [File Reference](#12-file-reference)

---

## 1. Project Overview

CorpBank is a fictional bank customer support system built to demonstrate **multi-agent AI patterns** using Claude via Amazon Bedrock. The system allows a customer to chat with an AI agent that can query real data, handle loan requests, search internal policy documents, and transfer the conversation to a human agent when needed — all in real time. All these lessons would be able to practice following this [Workbook](WORKSHOP_STEPS.md)

### What participants will learn

- How to build an agent that calls tools (functions) to get real data
- How to define tool schemas so Claude knows when and how to use them
- How to implement the agentic loop — the while loop that keeps Claude working until it finishes
- How to connect an agent to external document sources via MCP
- How to escalate to a human agent with full context transfer
- How to stream events in real time between the agent, the customer, and the backoffice
- How to prevent prompt injection and unauthorized access

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 + React + TypeScript |
| UI Components | shadcn/ui + Tailwind CSS |
| LLM | Claude via Amazon Bedrock (`@anthropic-ai/bedrock-sdk`) |
| Database API | SQLite + Express (Docker) |
| Document search | MCP filesystem server (`@modelcontextprotocol/sdk`) |
| Real-time | Server-Sent Events (SSE) |
| Validation | Zod |

---

## 2. Schedule

| Step | Duration | What you build | Anthropic concepts |
|---|---|---|---|
| 1 — Base Agent | 20 min | System prompt, structured output, Bedrock client | System prompt, structured output, Zod |
| 2 — Tool Calling | 30 min | DB helpers, tool definitions, agentic loop | Tools, agentic loop, stop_reason |
| 3 — Subagents | 30 min | Coordinator + 3 specialist agents | Multi-agent orchestration, delegation |
| 4 — MCP | 20 min | Internal document search via MCP filesystem | Model Context Protocol |
| 5 — Human-in-the-loop | 40 min | Real-time handoff, backoffice, SSE | Escalation patterns, human oversight |

**Total: ~2h 20min**

> Steps 1–4 focus on core Anthropic patterns. Step 5 adds the human oversight layer using SSE (a web standard, not Anthropic-specific).

---

## 3. Architecture

```
Customer browser  ──────────────────────────────────► localhost:3000/
                                                          │
                                                    Next.js API
                                                    /api/chat
                                                          │
                                              ┌───────────▼──────────────┐
                                              │     Router Agent          │
                                              │   (Claude via Bedrock)    │
                                              │                           │
                                              │  Tools:                   │
                                              │  • identify_customer      │
                                              │  • get_accounts           │
                                              │  • get_bills              │
                                              │  • get_transactions       │
                                              │  • get_credit             │
                                              │  • request_loan           │
                                              │  • search_docs (MCP)      │
                                              │  • escalate_to_human      │
                                              └──────┬──────────┬─────────┘
                                                     │          │
                                               CorpDB API    MCP server
                                              (SQLite REST)  (docs/ folder)
                                             localhost:3001  subprocess

Backoffice browser ─────────────────────────► localhost:3000/backoffice
                        SSE (/api/stream)          │
                        ◄──────────────────────────┘
                        real-time handoffs, decisions, customer messages
```

### Pages

| URL | Who uses it | Purpose |
|---|---|---|
| `localhost:3000` | Customer | Chat with the AI agent |
| `localhost:3000/backoffice` | Human agent | See handoffs, chat with customer, approve/reject |
| `localhost:3000/db` | Developer | CRUD interface for the database |

---

## 4. What is a Router Agent?

A **Router Agent** is an AI agent that acts as the single entry point for user requests. Instead of doing everything itself, it:

1. **Understands** the user's intent from natural language
2. **Decides** which tool or action to invoke
3. **Executes** the tool and interprets the result
4. **Responds** in a structured format the frontend can render
5. **Escalates** when the request is beyond its authority

In this project, the router agent is Claude. It receives the customer's message and decides in real time whether to query the database, search documents, submit a loan, or transfer to a human — all by calling tools.

### Why a router pattern?

Without a router, you would need to write `if/else` logic to handle every possible user input. With a router agent, Claude reads the conversation and decides what to do based on the tool descriptions you provide. The agent's behavior is controlled by:

- The **system prompt** — defines identity, scope, and rules
- The **tool definitions** — describe what each function does and when to use it
- The **conversation history** — gives context for each decision

### The system prompt (abbreviated)

```
You are a virtual customer support assistant for CorpBank.

RULES:
1. When the customer provides their name and phone, call identify_customer immediately.
2. Use tools to answer financial questions — never make up numbers.
3. For loans: always check get_credit first. Deny if above credit limit.
   Offer escalation to human for exceptions.
4. For loans above $500 within the limit: register with request_loan, ask for
   confirmation, then escalate if confirmed.
5. For policy/rate questions: use search_docs — never invent numbers.
6. For everything else requiring approval: respond that you lack the authority.
```

---

## 5. Tools

Tools are functions you expose to Claude. Claude reads the `name` and `description` and decides when to call them. You receive the call, execute the function, and return the result — Claude then continues.

### Tool definition anatomy

```typescript
{
  name: "get_accounts",
  description: "Returns all customer accounts (checking, savings, credit) with current balance.",
  input_schema: {
    type: "object",
    properties: { customer_id: { type: "string" } },
    required: ["customer_id"]
  }
}
```

> **The `description` is the most important field.** Claude never sees the implementation — only the description. A vague description leads to wrong or missing tool calls.

### Tools in this project

| Tool | Data source | Purpose |
|---|---|---|
| `identify_customer` | CorpDB | Match customer by name + phone |
| `get_accounts` | CorpDB | All account balances |
| `get_bills` | CorpDB | Open or paid bills/invoices |
| `get_transactions` | CorpDB | Account statement |
| `get_credit` | CorpDB | Credit limit and availability |
| `request_loan` | CorpDB | Submit a loan (auto-approved ≤ $500, pending > $500) |
| `search_docs` | MCP filesystem | Search internal policy documents |
| `escalate_to_human` | SSE + CorpDB | Transfer conversation to a human agent |

### Credit limit enforcement

The agent checks `get_credit` before processing any loan request:

| Scenario | Agent behavior |
|---|---|
| Amount ≤ credit limit AND ≤ $500 | Approve automatically |
| Amount ≤ credit limit AND > $500 | Register as pending, ask confirmation, escalate |
| Amount > credit limit | Deny, explain reason, offer exception via human |

---

## 6. The Agentic Loop

The agentic loop is the `while (true)` that keeps Claude working until it finishes. This is the core pattern of any tool-calling agent.

```typescript
while (true) {
  const response = await anthropic.messages.create({ model, system, tools, messages });

  if (response.stop_reason === "end_turn") {
    return extractText(response.content); // Claude finished
  }

  if (response.stop_reason === "tool_use") {
    // Execute each tool Claude requested, feed results back, loop
    messages.push({ role: "assistant", content: response.content });
    const results = await executeAllTools(response.content);
    messages.push({ role: "user", content: results });
  }
}
```

### `stop_reason` values

| Value | Meaning |
|---|---|
| `"end_turn"` | Claude finished — extract the text response |
| `"tool_use"` | Claude wants to call one or more tools — execute and loop |
| `"max_tokens"` | Response was cut off — increase `max_tokens` |

---

## 7. Escalate to Human (Human-in-the-Loop)

When a loan requires human approval, a customer is frustrated, or an exception is requested, the agent transfers the full conversation to a human agent (a **handoff**).

### Handoff flow

```
1. Agent detects escalation trigger
2. Agent calls escalate_to_human → { customer_id, loan_id?, reason }
3. route.ts checks for duplicate open handoff (deduplication)
4. POST /handoffs → CorpDB creates record with full conversation context
5. publish("*", handoff_created) → backoffice receives via SSE instantly
6. Customer chat enters "handoff mode" — messages go to human, not Claude
7. Human reads context, types reply → SSE pushes to customer chat
8. Human approves/rejects with amount → customer receives decision via SSE
9. Human clicks "Return to AI" → handoff resolved, customer back to Claude
```

### Context passed to the human

Every handoff includes:
- Full conversation history
- Agent's internal reasoning (`thinking`)
- Customer summary (name, credit limit)
- Loan ID and amount (pre-filled in the decision form)

### Real-time delivery

Events between the agent, customer, and backoffice are pushed via **Server-Sent Events (SSE)** — a standard browser protocol where the server keeps a connection open and pushes events without polling. Not an Anthropic concept, but the mechanism that makes the handoff feel instant.

---

## 8. MCP — Internal Document Search

**Model Context Protocol (MCP)** is an open standard for connecting AI agents to external data sources without writing custom integrations for each one.

In this project, an MCP filesystem server exposes the `docs/` folder. When the customer asks about rates, fees, or policies, the agent calls `search_docs` and returns accurate, sourced information.

### Documents

| File | Content |
|---|---|
| `docs/loan-policy.md` | Interest rates, repayment terms, eligibility, exception process |
| `docs/credit-limit-policy.md` | Default limits by account type, increase process |
| `docs/faq.md` | Common customer questions with official answers |
| `docs/products.md` | Account types, support channels |

### How the MCP client works

```typescript
// Spawns as a subprocess (stdio transport)
const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", DOCS_PATH],
});
const client = new Client({ name: "corpbank-docs", version: "1.0.0" });
await client.connect(transport);

// Agent calls these:
const { resources } = await client.listResources();  // list all docs
const { contents } = await client.readResource({ uri }); // read one doc
```

> To connect to Google Drive, Notion, or Confluence instead — swap the transport. The `listResources` and `readResource` calls stay identical.

---

## 9. Prompt Attack Prevention

### Mitigations applied

| Mitigation | Implementation |
|---|---|
| Customer ID server-side only | `getConvCustomer(conversationId)` — never from request body |
| Prompt injection via ID | Regex allowlist `/^[A-Za-z0-9_-]{1,64}$/` before interpolation |
| Backoffice endpoint auth | `x-backoffice-secret` header required for PATCH + POST (human actions) |
| Identity spoofing | `from` and `resolved_by` set server-side, never from client |
| Escalation scope | System prompt explicitly lists the two allowed escalation triggers |

---

## 10. Running the Project

### Prerequisites

- Node.js ≥ 18
- Docker + Docker Compose
- AWS account with Bedrock access (`AmazonBedrockFullAccess` IAM permission)

### Environment

Create `.env.local` in the project root:

```bash
AWS_REGION=us-east-1
BACKOFFICE_SECRET=workshop
CORPDB_URL=http://localhost:3001
```

### Start the infrastructure

```bash
cd infra
docker compose up -d
```

Verify:
```bash
curl http://localhost:3001/health     # {"status":"ok"}
curl http://localhost:3001/customers  # returns seed customers
```

### Start the app

```bash
npm install
npm run dev
```

### URLs

| URL | Purpose |
|---|---|
| `http://localhost:3000` | Customer chat |
| `http://localhost:3000/backoffice` | Human agent backoffice |
| `http://localhost:3000/db` | Database CRUD |

### Test customers

| Name | Phone | Credit Limit | Scenario |
|---|---|---|---|
| Alice Johnson | +1-555-0101 | $2,000 | Open bills, good history |
| Bob Smith | +1-555-0102 | $500 | Overdue bills, low limit |
| Carol Martinez | +1-555-0103 | $10,000 | VIP, all paid |
| David Lee | +1-555-0104 | $300 | Low credit limit — good for testing denials |

### Session management

- **New session:** click "New session" in the chat header — clears session storage and starts fresh
- **Reset database:** `docker compose down -v && docker compose up -d`

---

## 11. Database & API Contract

SQLite REST API (Docker, port 3001). Full contract: `infra/API_CONTRACT.md`

### Tables

| Table | Purpose |
|---|---|
| `customers` | Profiles: name, phone, credit_limit_usd |
| `accounts` | Balances: checking, savings, credit |
| `bills` | Bills with due dates and paid status |
| `transactions` | Account transaction history |
| `loans` | Requests with status: approved / pending / rejected |
| `pending_handoffs` | Handoff records with full conversation context |

### Key endpoints

```
GET  /customers/identify?name=Alice+Johnson&phone=+1-555-0101
GET  /accounts/:customerId
GET  /bills/:customerId?paid=0
GET  /credit/:customerId
POST /loans                     { customer_id, amount }
POST /handoffs                  { conversation_id, customer_id, loan_id, context }
GET  /handoffs?status=waiting
PATCH /loans/:id/resolve        { decision, resolved_by, reason }
PATCH /handoffs/:id/resolve
```

---

## 12. File Reference

```
customer-support-agent/
│
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   ├── route.ts           ← Main agent (router) — edit this during workshop
│   │   │   └── route_baseline.ts  ← Step 1 starting point (no tools)
│   │   ├── db/[...path]/route.ts  ← Proxy to CorpDB (avoids CORS)
│   │   ├── handoff/route.ts       ← Human sends messages + approves/rejects
│   │   └── stream/route.ts        ← SSE endpoint (EventSource target)
│   ├── backoffice/page.tsx        ← Human agent UI
│   ├── db/page.tsx                ← Database CRUD interface
│   └── lib/
│       ├── mcp-docs.ts            ← MCP client for document search
│       └── sse-store.ts           ← In-memory pub/sub + conv→customer map
│
├── components/
│   └── ChatArea.tsx               ← Customer chat UI + SSE client
│
├── docs/                          ← CorpBank internal policy documents (MCP source)
│   ├── loan-policy.md
│   ├── credit-limit-policy.md
│   ├── faq.md
│   └── products.md
│
├── infra/
│   ├── docker-compose.yml         ← Starts CorpDB container
│   ├── API_CONTRACT.md            ← Full REST API documentation
│   └── sqlite-api/
│       ├── server.js              ← Express REST API
│       └── seed.js                ← Schema + synthetic data
│
├── WORKSHOP.md                    ← Conceptual reference (what & why)
├── WORKSHOP_STEPS.md              ← Step-by-step guide (copy-paste workbook)
│
```

# CorpBank — Multi-Agent Workshop

Build a production-style customer support system from a single API call to a full multi-agent architecture with real data, document search, and live human handoff.

---

## Before you start

```bash
# 1. Clone and enter the project
cd customer-support-agent

# 2. Run setup — installs deps, starts Docker infra, creates .env.local
./setup.sh

# 3. Fill in your Bedrock token in .env.local
# AWS_BEARER_TOKEN_BEDROCK=<your-token>

# 4. Start the app
npm run dev
```

App runs at `http://localhost:3000`. No restarts needed during the workshop — Next.js hot-reloads on every save.

---

## What you will build

```
Customer message
  └── Coordinator                        ← decides who handles what
        ├── CustomerData Agent           ← identity, balances, transactions
        ├── Billing Agent                ← bills and invoices
        ├── Payments Agent               ← credit limits and loans
        ├── MCP (docs search)            ← internal policy documents
        └── escalate_to_human            ← live handoff to backoffice
```

---

## Test customers

| Name | Phone | Credit limit |
|---|---|---|
| Alice Johnson | +1-555-0101 | $2,000 |
| Bob Smith | +1-555-0102 | $500 |
| Carol Martinez | +1-555-0103 | $10,000 |
| David Lee | +1-555-0104 | $500 |

---

## Files you will create

```
app/
  api/chat/
    route_baseline.ts   ← starting point — read only
    route.ts            ← replace this in Step 4
  lib/agents/
    customer-data.ts    ← create in Step 3
    billing.ts          ← create in Step 3
    payments.ts         ← create in Step 3
    coordinator.ts      ← create in Step 4
    mcp-docs.ts         ← already exists — do not touch
```

---

---

# Step 1 — Basic Agent

**~15 min** · Single API call · Structured JSON output

---

`app/api/chat/route_baseline.ts` is your starting point and is already active as `route.ts`.

Open `http://localhost:3000` and send:

```
Hi, I want to check my balance. My name is Alice Johnson.
```

The agent responds but says it cannot access account data — correct, it has no tools yet.

---

### How it works

Every message from the frontend calls `POST /api/chat`. The handler makes **one call** to Claude and returns structured JSON:

```typescript
const response = await anthropic.messages.create({
  model,
  system: SYSTEM_PROMPT,  // agent identity and rules
  messages,               // full conversation history (more on this in Step 2)
});
// → Claude returns JSON text
// → Zod validates the shape
// → frontend renders each field
```

### Why JSON instead of plain text?

The frontend renders `response` as the chat bubble, turns `suggested_questions` into clickable buttons, and reads `redirect_to_agent` to show the handoff button. Plain text cannot drive this. The Zod schema is the contract — if Claude returns the wrong shape, the error is caught at the boundary, not silently in the UI.

```typescript
const responseSchema = z.object({
  thinking: z.string(),           // internal reasoning — shown in the debug panel, not to the customer
  response: z.string(),           // what the customer reads
  user_mood: z.enum([...]),       // drives the sentiment indicator
  suggested_questions: z.array(z.string()),  // quick-reply buttons
  redirect_to_agent: z.object({ should_redirect: z.boolean() }),
  debug: z.object({ context_used: z.boolean() }),
});
```

### Try it

Change the bank name in `SYSTEM_PROMPT` from `CorpBank` to anything. Save — the agent introduces itself with the new name immediately.

---

---

# Step 2 — Multi-turn Conversation

**~15 min** · No code changes · Understanding statelessness

---

Try this conversation:

```
Turn 1:  "My name is Alice Johnson."
Turn 2:  "What can you help me with?"
Turn 3:  "What was my name again?"
```

Claude remembers your name across all three turns — with no server-side session.

### Claude is stateless

Every API call starts completely fresh. There is no conversation object on the server. Between requests, Claude forgets everything.

**So how does it remember Alice?**

Open `components/ChatArea.tsx` around line 551:

```typescript
body: JSON.stringify({
  messages: [...messages, userMessage],  // the full history, every time
  model: selectedModel,
  conversationId,
}),
```

The frontend sends the **entire conversation array** on every request — not just the latest message. Claude reads from the beginning on every call. The `messages[]` array is the only memory.

### What this means in practice

| Consequence | Impact |
|---|---|
| Tokens grow with each turn | Longer conversations cost more |
| Server holds no state | Backend scales horizontally without session affinity |
| History controls behavior | You can inject context mid-conversation |
| Context window is the ceiling | Very long conversations eventually hit the model's max |

---

---

# Step 3 — Specialist Agents

**~25 min** · Multiple Claude instances · Separation of concerns

---

A single agent that knows everything is hard to tune. Improving loan logic can accidentally change how account balances are reported. Specialist agents solve this: each one has its own system prompt, its own tools, and can be changed independently.

---

### 3.1 — Create `app/lib/agents/customer-data.ts`

```typescript
// Customer Data specialist — identity, accounts, transactions.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

async function dbPost(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

const tools: any[] = [
  {
    name: "identify_customer",
    description:
      "Identifies the customer by full name and phone number. Call this as soon as the customer provides their name and phone — any phone format is accepted.",
    input_schema: {
      type: "object" as const,
      properties: {
        name:  { type: "string", description: "Customer full name" },
        phone: { type: "string", description: "Phone number in any format" },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "get_accounts",
    description: "Returns all customer accounts (checking, savings, credit) with current balance.",
    input_schema: {
      type: "object" as const,
      properties: { customer_id: { type: "string" } },
      required: ["customer_id"],
    },
  },
  {
    name: "get_transactions",
    description: "Returns the recent statement for a specific account.",
    input_schema: {
      type: "object" as const,
      properties: {
        account_id: { type: "string" },
        limit: { type: "number", description: "Number of transactions (max 50, default 10)" },
      },
      required: ["account_id"],
    },
  },
];

const ID_RE = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string, field: string): void {
  if (!id || !ID_RE.test(id)) throw new Error(`Invalid ${field}: ${id}`);
}

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "identify_customer":
        // POST keeps name and phone out of the URL and access logs
        return JSON.stringify(await dbPost("/customers/identify", {
          name: input.name,
          phone: input.phone,
        }));
      case "get_accounts":
        validateId(input.customer_id, "customer_id");
        return JSON.stringify(await db(`/accounts/${encodeURIComponent(input.customer_id)}`));
      case "get_transactions":
        validateId(input.account_id, "account_id");
        return JSON.stringify(await db(`/transactions/${encodeURIComponent(input.account_id)}?limit=${input.limit ?? 10}`));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the customer accounts specialist for CorpBank.
Use tools to fetch real customer data — never make up numbers.

IDENTIFICATION RULE — critical:
Full name + phone number are the ONLY credentials needed to identify a customer.
NEVER ask for a Customer ID, account number, or any other identifier.
Call identify_customer immediately when you have name + phone, then proceed.

TOOLS:
- identify_customer: identify the customer by name + phone → returns customer_id
- get_accounts: all account balances (requires customer_id from identify_customer)
- get_transactions: recent statement for an account
Be concise and professional. Reply in English.`;

export async function runCustomerDataAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("[CustomerDataAgent] task length:", task.length);
  const messages: any[] = [{ role: "user", content: task }];

  while (true) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (res.stop_reason === "end_turn") {
      return res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
    }

    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  [CustomerData] tool: ${block.name}`);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await executeTool(block.name, block.input),
      });
    }
    messages.push({ role: "user", content: results });
  }
}
```

---

### 3.2 — Create `app/lib/agents/billing.ts`

```typescript
// Billing specialist — bills and invoices.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

const tools: any[] = [
  {
    name: "get_bills",
    description:
      "Returns customer bills and invoices. Use paid=false to list only open/overdue ones.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
        paid: {
          type: "boolean",
          description: "true = paid, false = open/overdue. Omit to return all.",
        },
      },
      required: ["customer_id"],
    },
  },
];

const ID_RE = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string, field: string): void {
  if (!id || !ID_RE.test(id)) throw new Error(`Invalid ${field}: ${id}`);
}

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "get_bills": {
        validateId(input.customer_id, "customer_id");
        const paidParam = input.paid !== undefined ? `?paid=${input.paid ? 1 : 0}` : "";
        return JSON.stringify(await db(`/bills/${encodeURIComponent(input.customer_id)}${paidParam}`));
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the billing specialist for CorpBank.
Use tools to fetch real billing data — never make up numbers.
- get_bills: list bills (pass paid=false for open/overdue only)
Highlight due dates and overdue amounts clearly. Reply in English.`;

export async function runBillingAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("[BillingAgent] task length:", task.length);
  const messages: any[] = [{ role: "user", content: task }];

  while (true) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (res.stop_reason === "end_turn") {
      return res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
    }

    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  [Billing] tool: ${block.name}`);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await executeTool(block.name, block.input),
      });
    }
    messages.push({ role: "user", content: results });
  }
}
```

---

### 3.3 — Create `app/lib/agents/payments.ts`

```typescript
// Payments specialist — credit limits and loan requests.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

async function dbPost(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

const tools: any[] = [
  {
    name: "get_credit",
    description:
      "Returns the customer's credit limit (USD), how much has been used, and how much is available.",
    input_schema: {
      type: "object" as const,
      properties: { customer_id: { type: "string" } },
      required: ["customer_id"],
    },
  },
  {
    name: "request_loan",
    description:
      "Submits a loan request. Loans up to $500 are approved automatically. Above $500: pending for human approval. Always call this to register the request.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
        amount: { type: "number", description: "Amount in USD" },
      },
      required: ["customer_id", "amount"],
    },
  },
];

const ID_RE = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string, field: string): void {
  if (!id || !ID_RE.test(id)) throw new Error(`Invalid ${field}: ${id}`);
}

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "get_credit":
        validateId(input.customer_id, "customer_id");
        return JSON.stringify(await db(`/credit/${encodeURIComponent(input.customer_id)}`));
      case "request_loan":
        validateId(input.customer_id, "customer_id");
        return JSON.stringify(await dbPost("/loans", {
          customer_id: input.customer_id,
          amount: input.amount,
        }));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the loans and credit specialist for CorpBank.
Use tools to check credit and process loans — never make up numbers.
The coordinator always passes the customer_id resolved from name + phone — use it directly.
NEVER ask the customer for a Customer ID or any account credential.

- get_credit: check the customer's credit limit and availability
- request_loan: submit a loan request (always call this to register it)

LOAN RULES — follow this sequence exactly:
1. Always call get_credit first to check the customer's available credit.
2. If the requested amount exceeds credit_limit_usd:
   - Do NOT call request_loan.
   - Decline and explain the amount is above their credit limit.
   - Signal needs_human_approval=true so the coordinator can offer escalation.
3. If the amount is within credit_limit_usd AND $500 or below:
   - Call request_loan — it will be auto-approved.
4. If the amount is within credit_limit_usd AND above $500:
   - Call request_loan (status will be pending).
   - Inform the customer that human approval is required.
   - Signal needs_human_approval=true and include the loan_id in your response.

Always include a structured data block in your response:
{ "customer_id": "...", "loan_id": "...", "needs_human_approval": true/false }
The coordinator needs customer_id to create handoffs — always include it.
Reply in English.`;

export async function runPaymentsAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("[PaymentsAgent] task length:", task.length);
  const messages: any[] = [{ role: "user", content: task }];

  while (true) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (res.stop_reason === "end_turn") {
      return res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
    }

    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  [Payments] tool: ${block.name}`);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await executeTool(block.name, block.input),
      });
    }
    messages.push({ role: "user", content: results });
  }
}
```

---

### What all three agents have in common

```
system prompt    → identity and domain-specific rules
tools            → only what this agent needs
executeTool()    → switch/case: tool name → fetch call
runXxxAgent()    → agentic loop: call Claude → execute tools → repeat until end_turn
```

The `while (true)` loop is what makes an agent autonomous. Without it, Claude requests a tool but your code never sends the result back, so Claude never composes the final response. The loop runs until `stop_reason === "end_turn"` — meaning Claude has all the data it needs and is ready to answer.

---

---

# Step 4 — Orchestration

**~25 min** · Coordinator pattern · Agent-as-tool

---

The Coordinator receives the customer's message, decides which specialist to call, and synthesizes all responses into one reply. The key insight: **the specialists are the Coordinator's tools** — calling another Claude agent uses the exact same tool-calling mechanism as calling a database.

```
Coordinator calls delegate_billing
  → executor() runs runBillingAgent()
  → BillingAgent makes its own tool calls to the database
  → returns text back to the Coordinator
  → Coordinator synthesizes and responds to the customer
```

---

### 4.1 — Create `app/lib/agents/coordinator.ts`

```typescript
// Coordinator — routes requests to specialist agents and synthesizes the response.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import { runCustomerDataAgent } from "./customer-data";
import { runBillingAgent } from "./billing";
import { runPaymentsAgent } from "./payments";
import { searchDocs } from "./mcp-docs";

export const responseSchema = z.object({
  thinking: z.string(),
  response: z.string(),
  user_mood: z.enum(["positive", "neutral", "negative", "curious", "frustrated", "confused"]),
  suggested_questions: z.array(z.string()),
  redirect_to_agent: z.object({
    should_redirect: z.boolean(),
    reason: z.string().optional(),
  }),
  debug: z.object({ context_used: z.boolean() }),
  orchestration: z.object({
    agents_called: z.array(z.string()),
    needs_human_approval: z.boolean().optional(),
    loan_id: z.string().optional(),
  }).optional(),
});

export type CoordinatorResponse = z.infer<typeof responseSchema>;

export type EscalationInput = {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  reason: string;
  loan_id?: string;
};

export type CoordinatorResult = {
  response: CoordinatorResponse;
  escalation: EscalationInput | null;
};

function parseJSON(text: string) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  return {
    thinking: "Claude responded in plain text — wrapped as fallback.",
    response: text.trim(),
    user_mood: "neutral",
    suggested_questions: [],
    redirect_to_agent: { should_redirect: false },
    debug: { context_used: false },
  };
}

const SYSTEM_PROMPT = `You are the Coordinator Agent for CorpBank.
Understand the customer's request and delegate to the right specialist agent.

IDENTITY RULE — most important:
When the customer provides their full name and phone number, that is ALL that is needed
for identification. NEVER ask the customer for a Customer ID, account number, or any
other credential. The specialists resolve the Customer ID internally from name + phone.

AGENTS AVAILABLE:
- delegate_customer_data: identity, account balances, transaction history
- delegate_billing: bills, invoices, payment due dates
- delegate_payments: loan applications, credit limits
- search_docs: CorpBank internal policy documents (rates, fees, eligibility, products)
- escalate_to_human: transfer the conversation to a human agent

DELEGATION RULES:
1. As soon as the customer provides name + phone, delegate immediately — do not ask for more.
2. Always pass the customer's name, phone, and full question to the delegate.
3. For billing and payments tasks: first call delegate_customer_data to resolve the
   customer_id, then include that customer_id when calling delegate_billing or
   delegate_payments so they don't need to re-identify.
4. You may call more than one agent if the request spans multiple domains.
5. Synthesize all agent responses into a single coherent reply for the customer.
6. If the payments agent signals needs_human_approval=true, ask the customer whether
   they want to be transferred to a human agent. If they confirm → call escalate_to_human.

ESCALATION RULES:
- Only escalate when: (a) loan > $500 confirmed by customer, or (b) customer explicitly
  demands to speak with a human immediately.
- Do NOT escalate for credit limit questions, complaints, or routine inquiries.

POST-LOAN RESPONSE RULES:
After any loan outcome (approved, pending, or denied), always include in suggested_questions:
- One option to continue ("Is there anything else I can help you with?")
- One option to close ("No, that's all — thank you!")
- One contextually relevant follow-up (e.g. "What are my current account balances?")
Never leave suggested_questions empty after a loan decision.

IMPORTANT: Always respond as valid JSON:
{
  "thinking": "which agents you called and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true },
  "orchestration": { "agents_called": ["customer_data", "billing"] }
}`;

export async function runCoordinator(
  anthropic: AnthropicBedrock,
  model: string,
  messages: any[],
): Promise<CoordinatorResult> {
  console.log("[Coordinator] started");

  const tools: any[] = [
    {
      name: "delegate_customer_data",
      description:
        "Delegate to the customer data specialist. Use for: identity verification, account balances, transaction history.",
      input_schema: {
        type: "object" as const,
        properties: {
          task: { type: "string", description: "Full task including customer name, phone, and question" },
        },
        required: ["task"],
      },
    },
    {
      name: "delegate_billing",
      description:
        "Delegate to the billing specialist. Use for: open bills, overdue invoices, payment due dates.",
      input_schema: {
        type: "object" as const,
        properties: { task: { type: "string" } },
        required: ["task"],
      },
    },
    {
      name: "delegate_payments",
      description:
        "Delegate to the payments specialist. Use for: loan applications, credit limit questions.",
      input_schema: {
        type: "object" as const,
        properties: { task: { type: "string" } },
        required: ["task"],
      },
    },
    {
      name: "search_docs",
      description:
        "Search CorpBank's internal policy documents. Use when the customer asks about interest rates, fees, loan eligibility, account types, or anything requiring official documentation — not live account data.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Keywords to search, e.g. 'loan interest rate'" },
        },
        required: ["query"],
      },
    },
    {
      name: "escalate_to_human",
      description:
        "Transfer the conversation to a human agent. Use ONLY when: (1) a loan > $500 has been registered and the customer confirms they want to transfer, or (2) the customer explicitly demands to speak with a human immediately.",
      input_schema: {
        type: "object" as const,
        properties: {
          customer_id:    { type: "string" },
          customer_name:  { type: "string" },
          customer_phone: { type: "string", description: "Customer phone number — pass if available" },
          reason:         { type: "string", description: "Why the handoff is needed" },
          loan_id:        { type: "string", description: "Loan ID if this is a loan escalation" },
        },
        required: ["customer_id", "customer_name", "reason"],
      },
    },
  ];

  let escalation: EscalationInput | null = null;

  const executor = async (name: string, input: any): Promise<string> => {
    switch (name) {
      case "delegate_customer_data":
        return runCustomerDataAgent(anthropic, model, input.task);
      case "delegate_billing":
        return runBillingAgent(anthropic, model, input.task);
      case "delegate_payments":
        return runPaymentsAgent(anthropic, model, input.task);
      case "search_docs":
        return searchDocs(input.query);
      case "escalate_to_human":
        // Capture the signal — route.ts handles the actual DB write and SSE publish
        escalation = input as EscalationInput;
        return JSON.stringify({ escalated: true });
      default:
        return JSON.stringify({ error: `Unknown agent: ${name}` });
    }
  };

  const currentMessages = [...messages];

  while (true) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    if (res.stop_reason === "end_turn") {
      const text = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
      console.log("[Coordinator] done");
      return { response: responseSchema.parse(parseJSON(text)), escalation };
    }

    currentMessages.push({ role: "assistant", content: res.content });

    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  [Coordinator] -> ${block.name}`);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await executor(block.name, block.input),
      });
    }
    currentMessages.push({ role: "user", content: results });
  }
}
```

---

### 4.2 — Replace `app/api/chat/route.ts`

```typescript
// Chat API route — thin wrapper: receives the request, runs the coordinator, handles handoffs.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import crypto from "crypto";
import { publish } from "@/app/lib/sse-store";
import { runCoordinator } from "@/app/lib/agents/coordinator";

const anthropic = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
});

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function dbPost(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

export async function POST(req: Request) {
  const { messages, model, conversationId = crypto.randomUUID() } = await req.json();

  try {
    const { response: result, escalation } = await runCoordinator(
      anthropic,
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      messages.map((msg: any) => ({ role: msg.role, content: msg.content })),
    );

    if (escalation) {
      const existing = await fetch(`${CORPDB_URL}/handoffs?status=waiting`)
        .then((r) => r.ok ? r.json() : []).catch(() => []);
      const alreadyOpen = existing.some((h: any) => h.conversation_id === conversationId);

      if (alreadyOpen) {
        console.log(`[Handoff] already open for ${conversationId} — skipping duplicate`);
      } else {
        // Prefer the customer_id the coordinator resolved; fall back to name+phone lookup.
        let customer = escalation.customer_id
          ? await fetch(`${CORPDB_URL}/customers/${escalation.customer_id}`)
              .then((r) => r.ok ? r.json() : null).catch(() => null)
          : null;

        if (!customer && escalation.customer_name && escalation.customer_phone) {
          customer = await fetch(
            `${CORPDB_URL}/customers/identify?name=${encodeURIComponent(escalation.customer_name)}&phone=${encodeURIComponent(escalation.customer_phone)}`
          ).then((r) => r.ok ? r.json() : null).catch(() => null);
        }

        if (!customer) {
          console.error("[Handoff] cannot create — customer not resolved. customer_id:",
            escalation.customer_id ?? "(missing)", "loan_id:", escalation.loan_id ?? "(missing)");
          return Response.json({
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            handoff_initiated: false,
            ...result,
          });
        }

        const handoff = await dbPost("/handoffs", {
          conversation_id: conversationId,
          customer_id: customer.id,
          loan_id: escalation.loan_id ?? null,
          context: {
            messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
            agent_reasoning: escalation.reason,
            customer_summary: `${customer.name} | Credit limit: $${customer.credit_limit_usd}`,
          },
        });

        publish("*", {
          type: "handoff_created",
          payload: {
            handoff_id: handoff.id,
            conversation_id: conversationId,
            customer_id: customer.id,
            customer_name: customer.name ?? escalation.customer_name ?? "Unknown",
            loan_id: escalation.loan_id ?? "",
            amount: 0,
            context: handoff.context ?? {},
          },
        });

        console.log(`[Handoff] created: ${handoff.id}`);
      }
    }

    return Response.json({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      handoff_initiated: !!escalation,
      ...result,
    });
  } catch (error) {
    console.error("Agent error:", error);
    return Response.json(
      {
        response: "Sorry, an error occurred. Please try again.",
        thinking: "Internal error.",
        user_mood: "neutral",
        suggested_questions: [],
        redirect_to_agent: { should_redirect: false },
        debug: { context_used: false },
      },
      { status: 500 },
    );
  }
}
```

> **Why does `route.ts` handle the handoff instead of the Coordinator?**
> The Coordinator is an AI agent — it decides and signals intent (`escalation = input`). Creating a database record, publishing an SSE event, and deduplicating are infrastructure concerns. Keeping them in `route.ts` means you can swap SSE for WebSockets, or change the database, without touching any agent logic.

---

### 4.3 — Test

Send: `"What's my balance and any open bills? Alice Johnson, +1-555-0101"`

Terminal output:

```
[Coordinator] started
  [Coordinator] -> delegate_customer_data
  [CustomerData] tool: identify_customer
  [CustomerData] tool: get_accounts
  [Coordinator] -> delegate_billing
  [Billing] tool: get_bills
[Coordinator] done
```

Two agents called, one synthesized response.

---

---

# Step 5 — MCP

**~20 min** · Standard integration protocol · Swap data sources without changing agent code

---

MCP (Model Context Protocol) is an open standard for connecting AI agents to external data sources. The value: you change the server, not the agent code.

```
Without MCP:  Agent → custom fetch() → your API → data
With MCP:     Agent → MCP client → MCP server → any source
```

### The server is already running

`setup.sh` started two Docker containers:
- `corpdb-api` on port `3001` — SQLite REST API
- `corpbank-mcp-docs` on port `8082` — MCP filesystem server

The `corpbank-mcp-docs` container uses `supercorp/supergateway`, which wraps `@modelcontextprotocol/server-filesystem` (stdio) and exposes it as HTTP SSE at `http://localhost:8082/sse`. That is why the client uses `SSEClientTransport` — your app speaks HTTP, Docker handles stdio internally.

The server exposes the four files in `docs/`:

| File | Content |
|---|---|
| `loan-policy.md` | Interest rates, repayment terms, eligibility |
| `credit-limit-policy.md` | Default limits, increase process |
| `faq.md` | Common questions and answers |
| `products.md` | Account types and support channels |

### `mcp-docs.ts` already exists — open it

`app/lib/agents/mcp-docs.ts` is already created and already imported by the Coordinator. It:

1. Connects once via `SSEClientTransport` and caches the client in `globalThis`
2. Calls `list_directory` on the MCP server to get filenames
3. Calls `read_text_file` for each file and returns all content
4. Claude extracts the relevant answer from the full content (stuff RAG — no vector search needed at this scale)

The `onclose` / `onerror` handlers reset the cache flag so the next request reconnects automatically if the transport drops.

### Test

Send without identifying yourself — these are policy questions:

```
What's the interest rate for a $1,000 loan?
How can I increase my credit limit?
What accounts does CorpBank offer?
```

Terminal:

```
[Coordinator] started
  [Coordinator] -> search_docs
[Coordinator] done
```

To swap the data source for a remote one (Notion, Google Drive, a SQL database), change only `MCP_DOCS_URL` in `.env.local` and the Docker image in `infra/docker-compose.yml`. The agent code does not change.

---

---

# Step 6 — Human-in-the-Loop

**~20 min** · Real-time handoff · SSE

---

The handoff infrastructure is already in the repo. SSE (Server-Sent Events) is a native browser protocol for the server to push events without polling — no WebSocket library needed.

### Existing files — no changes needed

| File | Purpose |
|---|---|
| `app/lib/sse-store.ts` | In-memory pub/sub store for SSE events |
| `app/api/stream/route.ts` | SSE endpoint — frontend subscribes here |
| `app/api/handoff/route.ts` | Creates handoffs, receives backoffice messages |
| `app/backoffice/page.tsx` | Human agent UI |

### The full flow

```
Customer confirms transfer
  → Coordinator captures: escalation = { customer_id, reason, loan_id }
  → route.ts creates handoff record in DB  (POST /handoffs)
  → route.ts publishes:  publish("*", { type: "handoff_created", ... })
  → Backoffice has EventSource open on /api/stream?channel=*
  → Browser receives the event and renders the card — instantly, no refresh

Operator sends a message
  → POST /api/handoff
  → publish(conversationId, { type: "human_message", ... })
  → Customer chat has EventSource on /api/stream?channel=<conversationId>
  → Customer sees the message in real time

Operator approves or rejects the loan
  → PATCH /api/handoff
  → publish(conversationId, { type: "loan_resolved", decision: "approved" })
  → Chat renders the decision + three suggested next steps
  → handoffMode resets to false — chat input reactivates
```

### Test

Open two browser windows side by side:

- `http://localhost:3000` — customer
- `http://localhost:3000/backoffice` — human agent

In the customer chat:

```
I need an $800 loan. Carol Martinez, +1-555-0103
```

The agent registers the loan (pending — above $500), then asks if Carol wants to be transferred. Reply:

```
Yes, please transfer me to a human agent.
```

In the backoffice: Carol's card appears instantly with the full conversation, agent reasoning, credit summary, and loan amount.

From the backoffice:
- Type a message → Carol sees it in real time
- Click **Approve** → Carol receives the decision with next-step suggestions
- Or click **Return to AI agent** → conversation hands back to Claude

---

---

# What you built

```
route.ts  (HTTP layer — infra only)
  └── runCoordinator()
        ├── delegate_customer_data  → runCustomerDataAgent()
        │     tools: identify_customer · get_accounts · get_transactions
        ├── delegate_billing        → runBillingAgent()
        │     tools: get_bills
        ├── delegate_payments       → runPaymentsAgent()
        │     tools: get_credit · request_loan
        ├── search_docs             → searchDocs()  via MCP / Docker
        └── escalate_to_human       → signals route.ts
              route.ts: POST /handoffs → publish("*", handoff_created) → backoffice
```

---

## Key principles

| Decision | Why |
|---|---|
| Specialist agents per domain | Change billing without touching payments |
| Specialists as tools | No special multi-agent API — same tool-calling pattern throughout |
| Handoff logic in `route.ts`, not in the Coordinator | Agent decides; infrastructure executes. Swap SSE for WebSockets without touching agent code |
| `validateId()` before every URL interpolation | IDs come from the model — treat them as untrusted input |
| Tool name sent as POST body, not query string | Keeps PII out of access logs |
| Full `messages[]` array on every request | Claude is stateless; the array is the only memory |
| Tool `description` is the interface | Claude never sees your implementation — the description controls behavior |

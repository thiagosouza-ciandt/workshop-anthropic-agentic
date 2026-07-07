# CorpBank — Workshop Step-by-Step Guide

> **Before you start:** The infrastructure (database) is already running. The app is already running at `http://localhost:3000`. You only need to edit files and test in the browser.

---

## Overview

| Step | Duration | What you build | Focus |
|---|---|---|---|
| 1 — Base Agent | 20 min | System prompt, structured output, Bedrock client | Core Anthropic patterns |
| 2 — Tool Calling | 30 min | DB helpers, tool definitions, agentic loop | Core Anthropic patterns |
| 3 — Subagents | 30 min | Coordinator + 3 specialist agents | Core Anthropic patterns |
| 4 — MCP | 20 min | Internal document search via MCP filesystem | Core Anthropic patterns |
| 5 — Human-in-the-loop | 40 min | Real-time handoff, backoffice UI | Human oversight layer |

> **Total: ~2h 20min.** Steps 1–4 are pure Anthropic patterns. Step 5 adds human oversight using SSE (a web standard, not Anthropic-specific).

---

## How this works

You will work in **one file** for Steps 1–2:

```
app/api/chat/route.ts
```

Each step adds new blocks of code. You copy, paste, save, and test immediately in the browser. No restarts needed — Next.js hot-reloads automatically.

Steps 3–5 also create new files — the guide tells you exactly where.

---

## Test customers

| Name | Phone | Credit Limit | Good for testing |
|---|---|---|---|
| Alice Johnson | +1-555-0101 | $2,000 | Large loans, open bills |
| Bob Smith | +1-555-0102 | $500 | Overdue bills, low limit |
| Carol Martinez | +1-555-0103 | $10,000 | VIP, everything paid |
| David Lee | +1-555-0104 | $300 | Loan denials (credit limit) |

---

---

# STEP 1 — Base Agent

**Duration:** 20 minutes

**What you'll learn:** How to call Claude via Bedrock, how to give the agent an identity with a system prompt, and how to enforce structured JSON output validated by Zod.

---

## 1.1 — Open the file

Open `app/api/chat/route.ts`. You should see the baseline agent code with a system prompt but no tools.

Open the browser at `http://localhost:3000` and send a message:

```
Hi, I want to check my balance. My name is Alice Johnson.
```

**What happens:** The agent greets you but says it cannot access account data. This is correct — it has no tools yet.

---

## 1.2 — Look at the structure

The file has 5 sections. Read the comments:

```typescript
// ── 1. Bedrock Client   → connects to Claude via AWS
// ── 2. Response Schema  → Zod validates the JSON Claude returns
// ── 3. System Prompt    → gives the agent its identity and rules
// ── 4. JSON Parser      → strips markdown fences from Claude's response
// ── 5. Main Handler     → receives the HTTP request and calls Claude
```

### Discussion: Why JSON output?

The frontend renders `response`, shows `suggested_questions` as buttons, and detects `redirect_to_agent`. Plain text cannot do this. The Zod schema is the contract — if Claude changes the format, the error appears here, not silently in the UI.

### Discussion: What is `thinking`?

It is Claude's internal reasoning before answering. The customer never sees it. In Step 5, the backoffice will display it — this is the first step toward agent observability.

---

## 1.3 — Modify the system prompt

Change the agent name in the system prompt from `CorpBank` to your own bank name. Save and test — the agent should introduce itself with the new name.

---

## Step 1 — Done

The agent can hold a conversation but has no access to real data. When asked about balances or bills, it admits it cannot help. This is the **hook** for Step 2.

---

---

# STEP 2 — Tool Calling

**Duration:** 30 minutes

**What you'll learn:** How to define tools so Claude knows when to call them, how the agentic loop works, and how to connect the agent to a real database.

---

## 2.1 — Add DB helpers

Add this block **after** the `anthropic` client declaration (after line ~27):

```typescript
const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB error ${res.status}: ${path}`);
  return res.json();
}

async function dbPost(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB error ${res.status}: ${path}`);
  return res.json();
}
```

These are simple fetch wrappers. The agent calls these — not your LLM code.

---

## 2.2 — Add tool definitions

Add this block **after** the `responseSchema` declaration:

```typescript
const tools: Parameters<InstanceType<typeof AnthropicBedrock>["messages"]["create"]>[0]["tools"] = [
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
    name: "get_bills",
    description: "Returns customer bills and invoices. Use paid=false to list only open/overdue ones.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
        paid: { type: "boolean", description: "true = paid, false = open/overdue. Omit for all." },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "get_credit",
    description: "Returns the customer's credit limit (USD), how much has been used, and how much is available.",
    input_schema: {
      type: "object" as const,
      properties: { customer_id: { type: "string" } },
      required: ["customer_id"],
    },
  },
  {
    name: "request_loan",
    description:
      "Submits a loan request. Loans up to $500 are approved automatically. Above that they stay pending for human approval.",
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
```

> **Key insight:** Claude never sees the implementation. It only reads `name` and `description`. A vague description = wrong tool calls.

---

## 2.3 — Add the tool executor

Add this block **after** the tools array:

```typescript
async function executeTool(name: string, input: any): Promise<string> {
  try {
    let result: any;
    switch (name) {
      case "identify_customer":
        result = await db(
          `/customers/identify?name=${encodeURIComponent(input.name)}&phone=${encodeURIComponent(input.phone)}`
        );
        break;
      case "get_accounts":
        result = await db(`/accounts/${input.customer_id}`);
        break;
      case "get_bills":
        const paidParam = input.paid !== undefined ? `?paid=${input.paid ? 1 : 0}` : "";
        result = await db(`/bills/${input.customer_id}${paidParam}`);
        break;
      case "get_credit":
        result = await db(`/credit/${input.customer_id}`);
        break;
      case "request_loan":
        result = await dbPost("/loans", {
          customer_id: input.customer_id,
          amount: input.amount,
        });
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }
    return JSON.stringify(result);
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}
```

---

## 2.4 — Add the agentic loop

This is the most important block. Add it **after** `executeTool`:

```typescript
async function runAgentLoop(
  messages: any[],
  model: string,
): Promise<string> {
  let currentMessages = [...messages];

  while (true) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    // Claude finished — return the text
    if (response.stop_reason === "end_turn") {
      return response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
    }

    // Claude wants to call tools
    if (response.stop_reason === "tool_use") {
      currentMessages.push({ role: "assistant", content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`🔧 Tool call: ${block.name}`, block.input);
        const result = await executeTool(block.name, block.input);
        console.log(`✅ Tool result: ${block.name}`, result.slice(0, 200));
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      currentMessages.push({ role: "user", content: toolResults });
      // Loop continues — Claude processes results and decides next step
    }
  }
}
```

### Discussion: Why a loop?

Without the loop, Claude stops after requesting a tool call and never composes a final response. The loop keeps running until `stop_reason === "end_turn"`, which means Claude has finished thinking and composed a response.

---

## 2.5 — Update the system prompt

**Replace** the `SYSTEM_PROMPT` constant with this version:

```typescript
const SYSTEM_PROMPT = `You are a virtual customer support assistant for CorpBank.
Be friendly, clear, and concise. Always reply in English.

You have access to tools to query real customer data:
- identify_customer: identify the customer by name + phone
- get_accounts: all account balances
- get_bills: bills and invoices (open or paid)
- get_credit: credit limit and availability
- request_loan: submit a loan request

RULES:
1. When the customer provides their name and phone number, call identify_customer immediately.
   Providing name and phone is sufficient — do not ask them to log in anywhere.
2. Use tools to answer questions about financial data — never make up numbers.
3. For loan requests — follow this sequence:
   a. Call get_credit to check the customer's credit limit.
   b. If amount > credit_limit_usd: deny politely, offer escalation to human for an exception.
   c. If amount ≤ credit_limit_usd AND ≤ $500: call request_loan — auto-approved.
   d. If amount ≤ credit_limit_usd AND > $500: call request_loan (pending), ask for
      confirmation to transfer to a human agent.

IMPORTANT: Always respond as a valid JSON object:
{
  "thinking": "internal reasoning — what you queried and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true }
}`;
```

---

## 2.6 — Update the POST handler

**Replace** the `try` block inside the `POST` function with:

```typescript
  try {
    const text = await runAgentLoop(
      messages.map((msg: any) => ({ role: msg.role, content: msg.content })),
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    const parsed = parseJSON(text);
    const validated = responseSchema.parse(parsed);
    return Response.json({ id: crypto.randomUUID(), ...validated });
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
```

---

## 2.7 — Test

Send this message in the chat:

```
Hi, check my balance. My name is Alice Johnson and my phone is +1-555-0101
```

**Watch the terminal.** You should see:

```
🔧 Tool call: identify_customer { name: 'Alice Johnson', phone: '+1-555-0101' }
✅ Tool result: identify_customer {"id":"cust_001","name":"Alice Johnson",...}
🔧 Tool call: get_accounts { customer_id: 'cust_001' }
✅ Tool result: get_accounts [{"type":"checking","balance":3420.5},...]
```

The agent now returns **real data** from the database.

**Try also:**
- `"Do I have any open bills? Bob Smith, +1-555-0102"` — Bob has overdue bills
- `"I want a $200 loan. David Lee, +1-555-0104"` — auto-approved (within $300 limit, ≤ $500)
- `"I want a $400 loan. David Lee, +1-555-0104"` — **denied** (above $300 credit limit)
- `"I want a $800 loan. Alice Johnson, +1-555-0101"` — pending (within $2k limit, > $500)

---

---

# STEP 3 — Subagents

**Duration:** 30 minutes

**What you'll learn:** How to split a single agent into specialized agents, and how a Coordinator delegates work to them.

---

## 3.1 — Create the Customer Data agent

Create a new file: `app/lib/agents/customer-data.ts`

```typescript
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const db = async (path: string) => {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

const tools: any[] = [
  {
    name: "identify_customer",
    description: "Identifies the customer by full name and phone. Any phone format accepted.",
    input_schema: {
      type: "object" as const,
      properties: { name: { type: "string" }, phone: { type: "string" } },
      required: ["name", "phone"],
    },
  },
  {
    name: "get_accounts",
    description: "Returns all customer accounts with current balance.",
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
      properties: { account_id: { type: "string" }, limit: { type: "number" } },
      required: ["account_id"],
    },
  },
];

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "identify_customer":
        return JSON.stringify(await db(`/customers/identify?name=${encodeURIComponent(input.name)}&phone=${encodeURIComponent(input.phone)}`));
      case "get_accounts":
        return JSON.stringify(await db(`/accounts/${input.customer_id}`));
      case "get_transactions":
        return JSON.stringify(await db(`/transactions/${input.account_id}?limit=${input.limit ?? 10}`));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the customer data specialist for CorpBank.
Fetch and summarize customer profile, accounts, and transactions.
Use tools — never make up data. Respond concisely in English.`;

export async function runCustomerDataAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("👤 CustomerDataAgent:", task);
  const messages: any[] = [{ role: "user", content: task }];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages });
    if (res.stop_reason === "end_turn")
      return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  🔧 [CustomerData] ${block.name}`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: await executeTool(block.name, block.input) });
    }
    messages.push({ role: "user", content: results });
  }
}
```

---

## 3.2 — Create the Billing agent

Create: `app/lib/agents/billing.ts`

```typescript
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const db = async (path: string) => {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

const tools: any[] = [
  {
    name: "get_bills",
    description: "Lists customer bills. Use paid=false for open/overdue only.",
    input_schema: {
      type: "object" as const,
      properties: { customer_id: { type: "string" }, paid: { type: "boolean" } },
      required: ["customer_id"],
    },
  },
];

async function executeTool(name: string, input: any): Promise<string> {
  try {
    const paidParam = input.paid !== undefined ? `?paid=${input.paid ? 1 : 0}` : "";
    return JSON.stringify(await db(`/bills/${input.customer_id}${paidParam}`));
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the billing specialist for CorpBank.
Look up bills and invoices. Use tools — never make up data.
Respond concisely in English, highlighting amounts and due dates.`;

export async function runBillingAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("🧾 BillingAgent:", task);
  const messages: any[] = [{ role: "user", content: task }];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages });
    if (res.stop_reason === "end_turn")
      return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  🔧 [Billing] ${block.name}`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: await executeTool(block.name, block.input) });
    }
    messages.push({ role: "user", content: results });
  }
}
```

---

## 3.3 — Create the Payments agent

Create: `app/lib/agents/payments.ts`

```typescript
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const db = async (path: string) => {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};
const dbPost = async (path: string, body: object) => {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

const AGENT_LIMIT = 500;

const tools: any[] = [
  {
    name: "get_credit",
    description: "Returns the customer's credit limit and available credit.",
    input_schema: { type: "object" as const, properties: { customer_id: { type: "string" } }, required: ["customer_id"] },
  },
  {
    name: "request_loan",
    description: `Submits a loan. Up to $${AGENT_LIMIT}: approved automatically. Above: pending for human approval. Always call this to register the request.`,
    input_schema: {
      type: "object" as const,
      properties: { customer_id: { type: "string" }, amount: { type: "number" } },
      required: ["customer_id", "amount"],
    },
  },
];

async function executeTool(name: string, input: any): Promise<string> {
  try {
    if (name === "get_credit") return JSON.stringify(await db(`/credit/${input.customer_id}`));
    if (name === "request_loan") return JSON.stringify(await dbPost("/loans", { customer_id: input.customer_id, amount: input.amount }));
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the loans and credit specialist for CorpBank.
- Up to $${AGENT_LIMIT}: approve automatically with request_loan.
- Above $${AGENT_LIMIT}: call request_loan anyway (to register), but inform that human approval is required.
Respond concisely in English. Include { "loan_id": "...", "needs_human_approval": true/false } in your response.`;

export async function runPaymentsAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("💳 PaymentsAgent:", task);
  const messages: any[] = [{ role: "user", content: task }];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages });
    if (res.stop_reason === "end_turn")
      return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  🔧 [Payments] ${block.name}`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: await executeTool(block.name, block.input) });
    }
    messages.push({ role: "user", content: results });
  }
}
```

---

## 3.4 — Create the Coordinator

Create: `app/lib/agents/coordinator.ts`

```typescript
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import { runCustomerDataAgent } from "./customer-data";
import { runBillingAgent } from "./billing";
import { runPaymentsAgent } from "./payments";

export const responseSchema = z.object({
  thinking: z.string(),
  response: z.string(),
  user_mood: z.enum(["positive","neutral","negative","curious","frustrated","confused"]),
  suggested_questions: z.array(z.string()),
  redirect_to_agent: z.object({ should_redirect: z.boolean(), reason: z.string().optional() }),
  debug: z.object({ context_used: z.boolean() }),
  orchestration: z.object({
    agents_called: z.array(z.string()),
    needs_human_approval: z.boolean().optional(),
    loan_id: z.string().optional(),
  }).optional(),
});

export type CoordinatorResponse = z.infer<typeof responseSchema>;

const parseJSON = (text: string) => {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : stripped);
};

export async function runCoordinator(
  anthropic: AnthropicBedrock,
  model: string,
  messages: any[],
): Promise<CoordinatorResponse> {
  console.log("🎯 Coordinator started");

  const tools: any[] = [
    {
      name: "delegate_customer_data",
      description: "Delegates to the customer data agent. Use for: identity, profile, account balances, transactions.",
      input_schema: { type: "object" as const, properties: { task: { type: "string" } }, required: ["task"] },
    },
    {
      name: "delegate_billing",
      description: "Delegates to the billing agent. Use for: open bills, overdue invoices.",
      input_schema: { type: "object" as const, properties: { task: { type: "string" } }, required: ["task"] },
    },
    {
      name: "delegate_payments",
      description: "Delegates to the payments agent. Use for: loan requests, credit limit.",
      input_schema: { type: "object" as const, properties: { task: { type: "string" } }, required: ["task"] },
    },
  ];

  const executor = async (name: string, input: any) => {
    if (name === "delegate_customer_data") return runCustomerDataAgent(anthropic, model, input.task);
    if (name === "delegate_billing")       return runBillingAgent(anthropic, model, input.task);
    if (name === "delegate_payments")      return runPaymentsAgent(anthropic, model, input.task);
    return JSON.stringify({ error: `Unknown subagent: ${name}` });
  };

  const SYSTEM_PROMPT = `You are the Coordinator Agent for CorpBank — the central support hub.
Understand the request, delegate to the right subagents, and synthesize the response.

SUBAGENTS:
- delegate_customer_data: identity, profile, balances, statement
- delegate_billing: bills, invoices
- delegate_payments: loans, credit limit

RULES:
1. Always pass the customer name and phone (or customer_id) to subagents.
2. You may call more than one subagent if the request spans multiple domains.
3. If a loan needs human approval, include needs_human_approval: true and loan_id in orchestration.
4. If the customer asks to speak with a human, signal redirect_to_agent.

IMPORTANT: Always respond as valid JSON:
{
  "thinking": "which subagents you called and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true },
  "orchestration": { "agents_called": ["customer_data"], "needs_human_approval": false }
}`;

  const currentMessages = [...messages];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 4096, system: SYSTEM_PROMPT, tools, messages: currentMessages });
    if (res.stop_reason === "end_turn") {
      const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ");
      console.log("🎯 Coordinator done");
      return responseSchema.parse(parseJSON(text));
    }
    currentMessages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  📡 [Coordinator] → ${block.name}`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: await executor(block.name, block.input) });
    }
    currentMessages.push({ role: "user", content: results });
  }
}
```

---

## 3.5 — Update route.ts

At the **top** of `route.ts`, add the import:

```typescript
import { runCoordinator } from "@/app/lib/agents/coordinator";
```

**Remove** the following from `route.ts` (they moved to the agent files):
- The `tools` array
- The `executeTool` function
- The `runAgentLoop` function
- The `SYSTEM_PROMPT` constant
- The `responseSchema` (now imported from coordinator)

**Replace** the `try` block inside `POST` with:

```typescript
  try {
    const result = await runCoordinator(
      anthropic,
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      messages.map((msg: any) => ({ role: msg.role, content: msg.content })),
    );
    return Response.json({ id: crypto.randomUUID(), ...result });
  } catch (error) {
    console.error("Coordinator error:", error);
    return Response.json(
      { response: "Sorry, something went wrong.", thinking: "Internal error.", user_mood: "neutral",
        suggested_questions: [], redirect_to_agent: { should_redirect: false }, debug: { context_used: false } },
      { status: 500 },
    );
  }
```

---

## 3.6 — Test

Send: `"What's my balance and do I have any open bills? Alice Johnson, +1-555-0101"`

**Watch the terminal:**

```
🎯 Coordinator started
  📡 [Coordinator] → delegate_customer_data
    👤 CustomerDataAgent: ...
      🔧 [CustomerData] identify_customer
      🔧 [CustomerData] get_accounts
  📡 [Coordinator] → delegate_billing
    🧾 BillingAgent: ...
      🔧 [Billing] get_bills
🎯 Coordinator done
```

The Coordinator delegates to two agents in sequence and synthesizes a single response.

---

---

# STEP 4 — MCP: Internal Document Search

**Duration:** 20 minutes

**What you'll learn:** What MCP is, how to connect an agent to a local document server, and why MCP matters as a standard protocol for AI integrations.

---

## 4.1 — What is MCP?

**Model Context Protocol** is an open standard for connecting AI agents to external data sources. Instead of building a custom fetch integration for each data source, you connect to an MCP server — and the same agent code works with Google Drive, Notion, GitHub, databases, and more.

```
Without MCP:  Agent → custom fetch() → your API → data
With MCP:     Agent → MCP client → MCP server → any data source
```

In this step, the agent gains the ability to search CorpBank's internal policy documents. When a customer asks "what's the interest rate?", instead of making something up, the agent searches the real documentation.

---

## 4.2 — Install the MCP SDK

```bash
npm install @modelcontextprotocol/sdk
```

---

## 4.3 — Create `app/lib/mcp-docs.ts`

This file creates an MCP client that spawns the filesystem server as a subprocess:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

const DOCS_PATH = path.join(process.cwd(), "docs");

// Keep a single client alive across requests (stored in globalThis)
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

export async function searchDocs(query: string): Promise<string> {
  try {
    const client = await getMcpClient();

    // List all files the MCP server exposes
    const { resources } = await client.listResources();

    const results: { file: string; excerpt: string }[] = [];
    const queryLower = query.toLowerCase();

    for (const resource of resources) {
      const { contents } = await client.readResource({ uri: resource.uri });
      for (const content of contents) {
        if (content.type !== "text") continue;
        const text = content.text as string;
        if (text.toLowerCase().includes(queryLower)) {
          const lines = text.split("\n");
          const matchingLines = lines.filter(l => l.toLowerCase().includes(queryLower));
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
```

---

## 4.4 — Add import to `route.ts`

At the top of `app/api/chat/route.ts`, after the existing imports:

```typescript
import { searchDocs } from "@/app/lib/mcp-docs";
```

---

## 4.5 — Add the tool definition

Inside the `tools` array, before `escalate_to_human`:

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

---

## 4.6 — Add the executor case

Inside `executeTool`, before the `escalate_to_human` case:

```typescript
case "search_docs":
  result = await searchDocs(input.query);
  break;
```

---

## 4.7 — Update the system prompt

Add `search_docs` to the tool list in `SYSTEM_PROMPT`:

```
- search_docs: search CorpBank policy documents (rates, fees, eligibility, products)
```

---

## 4.8 — Look at the documents

Open the `docs/` folder. Four markdown files:

| File | Content |
|---|---|
| `loan-policy.md` | Interest rates, repayment, eligibility, exceptions |
| `credit-limit-policy.md` | Default limits, increase process, automatic reviews |
| `faq.md` | Common customer questions with answers |
| `products.md` | Account types, support channels |

These are the files the MCP server exposes. In production, these could be in Google Drive, Notion, or any other source with an MCP server.

---

## 4.9 — Test

Send these messages (no need to identify yourself for policy questions):

```
What's the interest rate for a $1,000 loan?
```

**Watch the terminal:**
```
🔧 Tool call: search_docs { query: 'interest rate 1000 loan' }
✅ Tool result: search_docs {"found":true,"results":[{"file":"loan-policy.md","excerpt":"$501 – $2,000 | Up to 24 months | 11.0%"}]}
```

Try also:
```
How can I increase my credit limit?
What happens if I miss a payment?
What accounts does CorpBank offer?
```

---

## Discussion: MCP transport types

| Transport | When to use |
|---|---|
| **stdio** | Local servers (filesystem, local DB) — subprocess spawned by the agent |
| **HTTP + SSE** | Remote servers (Google Drive, Notion, shared company knowledge base) |

In this step we used stdio. To connect to a remote MCP server (e.g., Google Drive), you would change only the transport — the `client.listResources()` and `client.readResource()` calls stay identical.

---

## Discussion: Why MCP instead of a direct fetch?

If you built a direct integration with Google Drive, you would write OAuth2 flows, handle pagination, parse Drive's API response format, and maintain the code as the API changes. With MCP, a community-maintained server handles all of that — you just connect and call `listResources`.

---

# STEP 5 — Human-in-the-Loop

**Duration:** 40 minutes

> **Note:** SSE (Server-Sent Events) is a standard browser protocol — not an Anthropic concept. This step focuses on the **human oversight pattern**: how to hand off, how to pass context, and how to let a human approve decisions the agent cannot make alone.

**What you'll learn:** How to stream events in real time with SSE, how to transfer a conversation to a human agent, and how the human can respond to and resolve the case.

---

## 5.1 — Create the SSE store

Create: `app/lib/sse-store.ts`

```typescript
export type SSEEvent =
  | { type: "handoff_created";   payload: HandoffPayload }
  | { type: "handoff_claimed";   payload: { handoff_id: string; claimed_by: string } }
  | { type: "human_message";     payload: { conversation_id: string; message: string; from: string } }
  | { type: "customer_message";  payload: { conversation_id: string; message: string } }
  | { type: "loan_resolved";     payload: { conversation_id: string; loan_id: string; decision: "approved" | "rejected"; reason?: string; amount?: number } }
  | { type: "agent_returned";    payload: { conversation_id: string } };

export type HandoffPayload = {
  handoff_id: string;
  conversation_id: string;
  customer_id: string;
  customer_name: string;
  loan_id: string;
  amount: number;
  context: {
    messages: Array<{ role: string; content: string }>;
    agent_reasoning: string;
    customer_summary: string;
  };
};

type Subscriber = (event: SSEEvent) => void;

const g = globalThis as any;
if (!g.__sse_subscribers) g.__sse_subscribers = new Map<string, Set<Subscriber>>();
const subscribers: Map<string, Set<Subscriber>> = g.__sse_subscribers;

if (!g.__conv_customer) g.__conv_customer = new Map<string, string>();
const convCustomer: Map<string, string> = g.__conv_customer;

export function setConvCustomer(conversationId: string, customerId: string) {
  convCustomer.set(conversationId, customerId);
}
export function getConvCustomer(conversationId: string): string | null {
  return convCustomer.get(conversationId) ?? null;
}

export function subscribe(channel: string, fn: Subscriber): () => void {
  if (!subscribers.has(channel)) subscribers.set(channel, new Set());
  subscribers.get(channel)!.add(fn);
  return () => subscribers.get(channel)?.delete(fn);
}

export function publish(channel: string, event: SSEEvent) {
  subscribers.get(channel)?.forEach((fn) => fn(event));
  if (channel !== "*") {
    subscribers.get("*")?.forEach((fn) => fn(event));
  }
}
```

---

## 5.2 — Create the SSE endpoint

Create: `app/api/stream/route.ts`

```typescript
import { subscribe, SSEEvent } from "@/app/lib/sse-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const channel = new URL(req.url).searchParams.get("channel") ?? "*";
  const enc = (s: string) => new TextEncoder().encode(s);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc(`: connected to ${channel}\n\n`));
      const unsub = subscribe(channel, (event: SSEEvent) => {
        try {
          controller.enqueue(enc(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
        } catch {}
      });
      const hb = setInterval(() => {
        try { controller.enqueue(enc(`: heartbeat\n\n`)); } catch { clearInterval(hb); }
      }, 25_000);
      req.signal.addEventListener("abort", () => { unsub(); clearInterval(hb); controller.close(); });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

---

## 5.3 — Create the handoff endpoint

Create: `app/api/handoff/route.ts`

```typescript
import { publish } from "@/app/lib/sse-store";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const BACKOFFICE_SECRET = process.env.BACKOFFICE_SECRET ?? "workshop";

function requireBackofficeAuth(req: Request): Response | null {
  const token = req.headers.get("x-backoffice-secret");
  if (token !== BACKOFFICE_SECRET)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

async function dbPatch(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

export async function POST(req: Request) {
  const body = await req.json();
  const action = body.action ?? "message";

  if (action === "customer_reply") {
    const { conversation_id, message } = body;
    publish("*", { type: "customer_message", payload: { conversation_id, message } });
    return Response.json({ success: true });
  }

  const authError = requireBackofficeAuth(req);
  if (authError) return authError;

  if (action === "return_to_agent") {
    const { conversation_id, handoff_id } = body;
    await dbPatch(`/handoffs/${handoff_id}/resolve`, {});
    publish(conversation_id, { type: "agent_returned", payload: { conversation_id } });
    publish("*",             { type: "agent_returned", payload: { conversation_id } });
    return Response.json({ success: true });
  }

  const { conversation_id, message } = body;
  publish(conversation_id, { type: "human_message", payload: { conversation_id, message, from: "Human agent" } });
  return Response.json({ success: true });
}

export async function PATCH(req: Request) {
  const authError = requireBackofficeAuth(req);
  if (authError) return authError;

  const { handoff_id, loan_id, conversation_id, decision, reason, amount } = await req.json();
  const resolved_by = "human";

  if (loan_id) {
    await dbPatch(`/loans/${loan_id}/resolve`, { decision, resolved_by: `human:${resolved_by}`, reason });
  }
  await dbPatch(`/handoffs/${handoff_id}/resolve`, {});

  const payload = { conversation_id, loan_id, decision, reason, amount };
  publish(conversation_id, { type: "loan_resolved", payload });
  publish("*",             { type: "loan_resolved", payload });

  return Response.json({ success: true, decision });
}
```

---

## 5.4 — Update route.ts (add escalation + SSE)

**Add** to the imports at the top of `route.ts`:

```typescript
import { publish, getConvCustomer, setConvCustomer } from "@/app/lib/sse-store";
```

**Add** the `escalate_to_human` tool to the tools array (inside the Coordinator, or in route.ts if using Step 2 style):

```typescript
{
  name: "escalate_to_human",
  description:
    "Transfers the conversation to a human agent. Use in two cases: (1) loan above $500 after customer confirms transfer, or (2) customer is clearly frustrated and demands a human immediately. Do NOT use for credit limit increases, complaints, or routine questions.",
  input_schema: {
    type: "object" as const,
    properties: {
      customer_id: { type: "string" },
      customer_name: { type: "string" },
      reason: { type: "string" },
      loan_id: { type: "string" },
    },
    required: ["customer_id", "customer_name", "reason"],
  },
},
```

**Update** the POST handler to extract `conversationId` and handle the handoff:

```typescript
export async function POST(req: Request) {
  const { messages, model, conversationId = crypto.randomUUID() } = await req.json();
  const customerId = getConvCustomer(conversationId);

  // ... run agent loop ...

  // After getting the result, if escalation happened:
  if (escalation) {
    const existing = await fetch(`${CORPDB_URL}/handoffs?status=waiting`)
      .then(r => r.ok ? r.json() : []).catch(() => []);
    const alreadyOpen = existing.some((h: any) => h.conversation_id === conversationId);

    if (!alreadyOpen) {
      const customer = await fetch(`${CORPDB_URL}/customers/${escalation.customer_id}`)
        .then(r => r.ok ? r.json() : null).catch(() => null);

      const handoff = await dbPost("/handoffs", {
        conversation_id: conversationId,
        customer_id: escalation.customer_id,
        loan_id: escalation.loan_id ?? null,
        context: {
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
          agent_reasoning: escalation.reason,
          customer_summary: customer
            ? `${customer.name} | Credit limit: $${customer.credit_limit_usd}`
            : escalation.customer_name,
        },
      });

      publish("*", {
        type: "handoff_created",
        payload: {
          handoff_id: handoff.id,
          conversation_id: conversationId,
          customer_id: escalation.customer_id,
          customer_name: escalation.customer_name ?? customer?.name ?? "Unknown",
          loan_id: escalation.loan_id ?? "",
          amount: 0,
          context: handoff.context ?? {},
        },
      });

      console.log(`🚨 Handoff created: ${handoff.id}`);
    }
  }

  return Response.json({
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    handoff_initiated: !!escalation,
    ...validated,
  });
}
```

---

## 5.5 — Create the backoffice page

Create the directory and file: `app/backoffice/page.tsx`

Copy the full contents from:

```
workshop/step4-backoffice/app/backoffice/page.tsx
```

This is the only file in the workshop that is pasted whole — it is pure UI with no agent logic.

---

## 5.6 — Test the full flow

Open two browser windows side by side:
- `http://localhost:3000` — customer
- `http://localhost:3000/backoffice` — human agent

**In the customer chat:**
```
I need a $800 loan. Carol Martinez, +1-555-0103
```

The agent will register the loan and ask for confirmation:
```
Would you like me to transfer you to a human agent now?
```

Reply `yes`.

**In the backoffice:** Carol's handoff appears instantly with:
- Full conversation history
- Agent reasoning
- Customer credit limit summary
- Pre-filled loan amount

**From the backoffice:**
1. Type a message to Carol — it appears in her chat in real time
2. Enter an approved amount and click **Approve** — Carol receives the decision
3. Or click **Return to AI agent** — Carol is transferred back to Claude

---

## Discussion: What just happened?

```
Customer types "yes"
  → Agent calls escalate_to_human
  → route.ts creates a handoff in the DB
  → route.ts calls publish("*", handoff_created)
  → Backoffice has an EventSource open on /api/stream?channel=*
  → Browser receives the SSE event and renders the handoff card — instantly
  → Human types a message → POST /api/handoff → publish(conversationId, human_message)
  → Customer chat has an EventSource on /api/stream?channel=<conversationId>
  → Customer receives the message in real time
```

No polling. No refresh. The server pushes events as they happen.

---

---

---

---

# Congratulations

You have built a complete multi-agent customer support system with:

| Capability | Where it lives |
|---|---|
| Natural language understanding | Claude system prompt + tool descriptions |
| Real data access | Tool calling → CorpDB REST API |
| Autonomous decision-making | Agentic loop (while / stop_reason) |
| Specialist delegation | Coordinator + subagents |
| Human escalation with context | `escalate_to_human` tool + handoff flow |
| Real-time communication | SSE (EventSource + publish/subscribe) |
| Internal document search | MCP filesystem server + `search_docs` tool |
| Prompt injection prevention | Customer ID validated server-side + regex allowlist |
| Endpoint protection | Shared secret on backoffice endpoints |

---

## Key takeaways

**1. The description IS the interface**
Claude never sees implementation code. The `description` field on each tool is how you control agent behavior. Invest time writing precise descriptions.

**2. The loop is the agent**
The `while (true)` loop with `stop_reason` is what makes Claude autonomous. Without it, Claude stops after requesting a tool call and never answers.

**3. Structured output is the contract**
Zod validates that Claude always returns the expected format. If it doesn't, the error is caught at the boundary — not silently in the UI.

**4. SSE is simpler than WebSocket for push**
For server-to-client events, SSE is native in browsers, requires no library, and is stateless on reconnect. Reserve WebSocket for bidirectional real-time (e.g., collaborative editing).

**5. MCP standardizes integrations**
Instead of writing a custom integration for every data source, MCP gives you one interface that works with any server. Change the transport (stdio → HTTP), not the agent code.

**6. Never trust the client**
Customer ID, agent identity (`from`, `resolved_by`), and session state are all derived server-side. The client can only supply what it cannot abuse.

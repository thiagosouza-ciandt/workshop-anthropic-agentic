# Step 3 — Subagents (30 min)

## Concept

Split the single agent into specialized agents.
The Coordinator delegates to specialists — it never queries the DB directly.

```
route.ts  →  Coordinator  →  CustomerDataAgent
                          →  BillingAgent
                          →  PaymentsAgent
```

Participants create 4 new files and update `route.ts` to call the Coordinator.

---

## Block A — Create `app/lib/agents/customer-data.ts`

New file — paste as-is:

```ts
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const db = async (path: string) => {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

const tools: AnthropicBedrock.Tool[] = [
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
      properties: {
        account_id: { type: "string" },
        limit: { type: "number" },
      },
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
  const messages: AnthropicBedrock.MessageParam[] = [{ role: "user", content: task }];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages });
    if (res.stop_reason === "end_turn")
      return res.content.filter((b): b is AnthropicBedrock.TextBlock => b.type === "text").map((b) => b.text).join(" ");
    messages.push({ role: "assistant", content: res.content });
    const results: AnthropicBedrock.ToolResultBlockParam[] = [];
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

## Block B — Create `app/lib/agents/billing.ts`

```ts
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const db = async (path: string) => {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

const tools: AnthropicBedrock.Tool[] = [
  {
    name: "get_bills",
    description: "Lists customer bills. Use paid=false for open/overdue only.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
        paid: { type: "boolean" },
      },
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
  const messages: AnthropicBedrock.MessageParam[] = [{ role: "user", content: task }];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages });
    if (res.stop_reason === "end_turn")
      return res.content.filter((b): b is AnthropicBedrock.TextBlock => b.type === "text").map((b) => b.text).join(" ");
    messages.push({ role: "assistant", content: res.content });
    const results: AnthropicBedrock.ToolResultBlockParam[] = [];
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

## Block C — Create `app/lib/agents/payments.ts`

```ts
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";
const db = async (path: string) => {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};
const dbPost = async (path: string, body: object) => {
  const res = await fetch(`${CORPDB_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

const AGENT_LIMIT = 500;

const tools: AnthropicBedrock.Tool[] = [
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
Process loan requests and credit limit queries.
- Up to $${AGENT_LIMIT}: approve automatically with request_loan.
- Above $${AGENT_LIMIT}: call request_loan anyway (to register), but inform that human approval is required.
Respond concisely in English. Include { "loan_id": "...", "needs_human_approval": true/false } in your response.`;

export async function runPaymentsAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("💳 PaymentsAgent:", task);
  const messages: AnthropicBedrock.MessageParam[] = [{ role: "user", content: task }];
  while (true) {
    const res = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages });
    if (res.stop_reason === "end_turn")
      return res.content.filter((b): b is AnthropicBedrock.TextBlock => b.type === "text").map((b) => b.text).join(" ");
    messages.push({ role: "assistant", content: res.content });
    const results: AnthropicBedrock.ToolResultBlockParam[] = [];
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

## Block D — Create `app/lib/agents/coordinator.ts`

```ts
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
  messages: AnthropicBedrock.MessageParam[],
): Promise<CoordinatorResponse> {
  console.log("🎯 Coordinator started");

  const tools: AnthropicBedrock.Tool[] = [
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
1. Always pass the customer name and phone (or customer_id if already identified) to subagents.
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
      const text = res.content.filter((b): b is AnthropicBedrock.TextBlock => b.type === "text").map((b) => b.text).join(" ");
      console.log("🎯 Coordinator done");
      return responseSchema.parse(parseJSON(text));
    }
    currentMessages.push({ role: "assistant", content: res.content });
    const results: AnthropicBedrock.ToolResultBlockParam[] = [];
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

## Block E — Update `route.ts`

**Add** these two lines at the top of `route.ts`, after the existing imports:

```ts
import { runCoordinator, responseSchema } from "@/app/lib/agents/coordinator";
```

**Remove** the local `responseSchema` declaration (Zod schema block) — it now comes from the coordinator.

**Remove** all tools, executeTool, runAgentLoop, and SYSTEM_PROMPT — they move to the agent files.

**Replace** the `try` block inside `POST` with:

```ts
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

## Test

Open two messages:
- `"What's my balance and do I have any open bills? Alice Johnson, +1-555-0101"`

Watch the terminal:
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

## Discussion points

- **Why do subagents use tools instead of direct DB calls?** Each agent has a smaller, focused context — less confusion, more precise answers.
- **Why does the Coordinator not query the DB?** Separation of concerns. If the billing API changes tomorrow, only `billing.ts` changes.
- **What is `orchestration.agents_called`?** Metadata for the backoffice (Step 4) — it shows which agents ran for each request.

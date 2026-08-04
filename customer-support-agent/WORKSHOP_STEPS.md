# CorpBank — Multi-Agent Workshop

Build a production-style customer support system — from a single API call to a full multi-agent architecture with real data, document search, and live human handoff.

![Customer Support Case](tutorial/images/customer-support-workshop-case.png)

---

## Before you start

### Open your terminal and run the commands bellow
![Open Terminal](tutorial/images/ws-anthropic-001.png)

```bash
# 1. Clone the project into your Downloads directory
cd Downloads
git clone https://github.com/thiagosouza-ciandt/workshop-anthropic-agentic
```

![Access Directory](tutorial/images/ws-anthropic-002.png)
![Clone repository](tutorial/images/ws-anthropic-003.png)


```bash
# 2. Access the directory and run the setup script — (installs deps, starts Docker infra, creates .env.local)
# It may take up to 5 minutes to complete

cd workshop-anthropic-agentic/customer-support-agent
./setup.sh
```
![Setup](tutorial/images/ws-anthropic-004.png)


### Open VSCode, then open the workshop directory and edit the API Key in .env.local (File > Open Folder)

![Open VS Code](tutorial/images/ws-anthropic-005.png)
![Open Code Folder](tutorial/images/ws-anthropic-006.png)
![Select Folder](tutorial/images/ws-anthropic-007.png)
![Edit API Key](tutorial/images/ws-anthropic-008.png)


### Run the project on terminal (Stand alone terminal or VSCode terminal)
![run the project](tutorial/images/ws-anthropic-009.png)


```bash
# 4. Start the app from the terminal
cd customer-support-agent
npm run dev
```

App runs at `http://localhost:3000`. No restarts needed — Next.js hot-reloads on every save.
![web browser](tutorial/images/ws-anthropic-010.png)

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

---

# Step 1 — Basic Agent

**~15 min** · Single API call · Structured JSON output · Ground rules

---

Open `http://localhost:3000` and send:

```
Hi, I want to check my balance. My name is Alice Johnson.
```

The agent responds but says it cannot access account data — correct, it has no tools yet.
![web browser](tutorial/images/ws-anthropic-011.png)

---

### How it works

Every message from the frontend calls `POST /api/chat`. The handler calls the coordinator, which makes **one call** to Claude and returns structured JSON:

```typescript
const response = await anthropic.messages.create({
  model,
  system: SYSTEM_PROMPT,  // agent identity and rules
  messages,               // full conversation history
});
// → Claude returns JSON text
// → Zod validates the shape
// → frontend renders each field
```

### Explore the system prompt

Open `app/lib/agents/coordinator.ts` and find `SYSTEM_PROMPT`.
![System prompt](tutorial/images/ws-anthropic-012.png)


**Try it:**

1. Change the bank name from `CorpBank` to anything. Save — the agent introduces itself with the new name immediately.
2. Add a rule like `Always respond in Portuguese.` — see it take effect instantly.
3. Add a guardrail: `Never discuss competitors or other banks.` — test it in the chat.

The system prompt is the agent's contract. Ground rules, persona, and constraints all live here.

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

The frontend sends the **entire conversation array** on every request. Claude reads from the beginning on every call. The `messages[]` array is the only memory.

### What this means in practice

| Consequence | Impact |
|---|---|
| Tokens grow with each turn | Longer conversations cost more |
| Server holds no state | Backend scales horizontally without session affinity |
| History controls behavior | You can inject context mid-conversation |
| Context window is the ceiling | Very long conversations eventually hit the model's max |

---

---

# Step 3 — Customer Data Agent

**~20 min** · First specialist · Identity + account data · Test identification

---

A single agent that knows everything is hard to tune. Improving loan logic can accidentally change how balances are reported. Specialist agents solve this: each one has its own system prompt, its own tools, and can be changed independently.

In this step you wire up the first specialist: the Customer Data agent, which handles identity verification and account queries.

---

### 3.1 — Fill in `app/lib/agents/customer-data.ts`

The file already has the imports. Add the following code:

- Database Connection REST

```typescript
// database connection
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
```

- Tools Definition
```typescript
// tools definition
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
```
- Regex for ID validation
```typescript
const ID_RE = /^[a-zA-Z0-9_-]+$/;

function validateId(id: string, field: string): void {
  if (!id || !ID_RE.test(id)) throw new Error(`Invalid ${field}: ${id}`);
}

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "identify_customer":
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
```
- Add System Prompt
```typescript
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
```

- Finish with the function that runs the agent
```typescript
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

### 3.2 — Upgrade the Coordinator to delegate to the specialist

The coordinator stub (Step 1) calls Claude directly with no tools. Now you'll replace `runCoordinator` with a version that has a tool-calling loop and delegates to the customer data specialist.

**Add the import** at the top of `app/lib/agents/coordinator.ts`:

```typescript
import { runCustomerDataAgent } from "./customer-data";
```

**Update `SYSTEM_PROMPT`** — replace the `IMPORTANT RULES` block with:

```
AGENTS AVAILABLE:
- delegate_customer_data: identity, account balances, transaction history

DELEGATION RULES:
1. As soon as the customer provides name + phone, delegate immediately.
2. Always pass the customer's name, phone, and full question to the delegate.
3. Synthesize the agent response into a single coherent reply for the customer.

IMPORTANT: Always respond as valid JSON:
{
  "thinking": "which agents you called and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true },
  "orchestration": { "agents_called": ["customer_data"] }
}
```

**Replace the `runCoordinator` function** with:

```typescript
export async function runCoordinator(
  anthropic: AnthropicBedrock,
  model: string,
  messages: any[],
): Promise<CoordinatorResult> {
  console.log("[Coordinator] started");

  const SPECIALIST_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  
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
  ];

  let escalation: EscalationInput | null = null;

  const executor = async (name: string, input: any): Promise<string> => {
    switch (name) {
      case "delegate_customer_data":
        return runCustomerDataAgent(anthropic, SPECIALIST_MODEL, input.task);
      default:
        return JSON.stringify({ error: `Unknown agent: ${name}` });
    }
  };

  const currentMessages = [...messages];

  while (true) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    if (res.stop_reason === "end_turn") {
      const text = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
      const parsed = parseJSON(text);
      console.log("[Coordinator] done");
      if (process.env.DEBUG_THINKING) console.log("[Coordinator] reasoning:", JSON.stringify({ thinking: parsed.thinking }, null, 2));
      console.log("[Coordinator] tokens:", JSON.stringify({ input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens }, null, 2));
      return { response: responseSchema.parse(parsed), escalation };
    }

    currentMessages.push({ role: "assistant", content: res.content });

    const toolBlocks = res.content.filter((b: any) => b.type === "tool_use");
    toolBlocks.forEach((b: any) => console.log(`  [Coordinator] -> ${b.name}`));
    const results = await Promise.all(
      toolBlocks.map(async (block: any) => ({
        type: "tool_result",
        tool_use_id: block.id,
        content: await executor(block.name, block.input),
      }))
    );
    currentMessages.push({ role: "user", content: results });
  }
}
```



---

### 3.3 — Test

Send:

```
What's my balance? Alice Johnson, +1-555-0101
```

Terminal output:

```
[Coordinator] started
  [Coordinator] -> delegate_customer_data
[CustomerDataAgent] task length: 89
  [CustomerData] tool: identify_customer
  [CustomerData] tool: get_accounts
[Coordinator] done
```

The coordinator delegated, the specialist called the database, and Claude synthesized a real answer.

![Customer Data Agent](tutorial/images/ws-anthropic-011.png)

---

# Step 4 — Billing Agent

**~15 min** · Second specialist · Bills and invoices

---

### 4.1 — Fill in `app/lib/agents/billing.ts`

The file already has the imports. Add:

```typescript
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

### 4.2 — Add `delegate_billing` to the Coordinator

**Add the import:**

```typescript
import { runBillingAgent } from "./billing";
```


**Add to the system prompt:**

```
- delegate_billing: bills, invoices, payment due dates
```

**Add the delegation rule** — billing needs the `customer_id` already resolved:

```
4. For billing tasks: first call delegate_customer_data to resolve the customer_id,
   then pass that customer_id when calling delegate_billing.
```

**Add the tool:**

```typescript
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
```


Add the case to the function **executor**:

```typescript
case "delegate_billing":
  return runBillingAgent(anthropic, SPECIALIST_MODEL, input.task);
```
---

### 4.3 — Test

Send:

```
What's my balance and any open bills? Alice Johnson, +1-555-0101
```

Terminal:

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

![Billing Data Agent](tutorial/images/ws-anthropic-014.png)

---

---

# Step 5 — Payments Agent

**~15 min** · Third specialist · Credit limits and loan requests

---

### 5.1 — Fill in `app/lib/agents/payments.ts`

Add:

```typescript
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

### 5.2 — Add `delegate_payments` to the Coordinator

**Add the import:**

```typescript
import { runPaymentsAgent } from "./payments";
```

**Add to the system prompt:**

```
- delegate_payments: loan applications, credit limits
```

**Add the escalation rules:** After delegation rules

```
ESCALATION RULES:
- Only escalate when: (a) loan > $500 confirmed by customer, or (b) customer explicitly
  demands to speak with a human immediately.
- If the payments agent signals needs_human_approval=true, ask the customer whether
  they want to be transferred to a human agent. If they confirm → call escalate_to_human.
```

**Add the tool:**

```typescript
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
```

**Add the case:**

```typescript
case "delegate_payments":
  return runPaymentsAgent(anthropic, SPECIALIST_MODEL, input.task);
```

---

### 5.3 — Test

Send:

```
I want a $200 loan. David Lee	+1-555-0104
```
![Payments Agent](tutorial/images/ws-anthropic-015.png)

---

---

# Step 6 — MCP (Document Search)

**~20 min** · Standard integration protocol · Policy documents

---

MCP (Model Context Protocol) is an open standard for connecting AI agents to external data sources. The value: you change the server, not the agent code.


Without MCP:  Agent → custom fetch() → your API → data
With MCP:     Agent → MCP client → MCP server → any source


### The server is already running

`setup.sh` started two Docker containers:
- `corpdb-api` on port `3001` — SQLite REST API
- `corpbank-mcp-docs` on port `8082` — MCP filesystem server

The MCP container wraps `@modelcontextprotocol/server-filesystem` and exposes it as HTTP SSE at `http://localhost:8082/sse`.

The server exposes the four files in `docs/`:

| File | Content |
|---|---|
| `loan-policy.md` | Interest rates, repayment terms, eligibility |
| `credit-limit-policy.md` | Default limits, increase process |
| `faq.md` | Common questions and answers |
| `products.md` | Account types and support channels |

### `mcp-docs.ts` is already created — add it to the Coordinator

**Add the import:**

```typescript
import { searchDocs } from "./mcp-docs";
```


**Add to the system prompt:**

```
- search_docs: CorpBank internal policy documents (rates, fees, eligibility, products)
```

**Add the tool:**

```typescript
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
```

**Add the case:**

```typescript
case "search_docs":
  return searchDocs(input.query);
```


---

### Test

Send without identifying yourself — these are policy questions:

```
- What's the interest rate for a $1,000 loan?
- How can I increase my credit limit?
- What accounts does CorpBank offer?
```

Terminal:

```
[Coordinator] started
  [Coordinator] -> search_docs
[Coordinator] done
```
![MCP](tutorial/images/ws-anthropic-016.png)
---

---

# Step 7 — Human-in-the-Loop

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

### Add `escalate_to_human` to the Coordinator

**Add the tool:**

```typescript
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
```

**Add the case** — the coordinator only signals intent; `route.ts` handles the DB write and SSE publish:

```typescript
case "escalate_to_human":
  escalation = input as EscalationInput;
  return JSON.stringify({ escalated: true });
```



### The full flow

```
Customer confirms transfer
  → Coordinator sets: escalation = { customer_id, reason, loan_id }
  → route.ts creates handoff record in DB  (POST /handoffs)
  → route.ts publishes:  publish("*", { type: "handoff_created", ... })
  → Backoffice has EventSource open on /api/stream?channel=*
  → Browser receives the event and renders the card — instantly, no refresh

Operator sends a message
  → POST /api/handoff
  → publish(conversationId, { type: "human_message", ... })
  → Customer chat has EventSource on /api/stream?channel=<conversationId>
  → Customer sees the message in real time
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

In the backoffice: Carol's card appears instantly with the full conversation, agent reasoning, and credit summary.

From the backoffice:
- Type a message → Carol sees it in real time
- Click **Approve** → Carol receives the decision with next-step suggestions
- Or click **Return to AI agent** → conversation hands back to Claude

![Escalation 1](tutorial/images/ws-anthropic-017.png)
![Escalation 2](tutorial/images/ws-anthropic-018.png)
![Escalation 3](tutorial/images/ws-anthropic-019.png)

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
| Handoff logic in `route.ts`, not in the Coordinator | Agent decides; infrastructure executes |
| `validateId()` before every URL interpolation | IDs come from the model — treat as untrusted input |
| Tool name sent as POST body, not query string | Keeps PII out of access logs |
| Full `messages[]` array on every request | Claude is stateless; the array is the only memory |
| Tool `description` is the interface | Claude never sees your implementation — the description controls behavior |

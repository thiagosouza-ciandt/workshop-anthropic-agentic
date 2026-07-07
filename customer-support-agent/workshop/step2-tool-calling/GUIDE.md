# Step 2 — Tool Calling (30 min)

## Concept

The agent now queries real data from the database.
Participants add blocks to the existing `route.ts` — no file replacement needed.

---

## Starting point

`app/api/chat/route.ts` should be the Step 1 file.
You will add 5 blocks to it.

---

## Block A — DB helpers

Add right after the `anthropic` client declaration (after line ~25):

```ts
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

---

## Block B — Tools

Add after the `responseSchema` declaration:

```ts
const tools: AnthropicBedrock.Tool[] = [
  {
    name: "identify_customer",
    description:
      "Identifies the customer by full name and phone number. Call this as soon as the customer provides their name and phone — any phone format is accepted.",
    input_schema: {
      type: "object" as const,
      properties: {
        name:  { type: "string" },
        phone: { type: "string" },
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

---

## Block C — Tool executor

Add after the tools array:

```ts
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
      case "request_loan":
        result = await dbPost("/loans", { customer_id: input.customer_id, amount: input.amount });
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

## Block D — Agentic loop

Add after `executeTool`. This is the core pattern of any tool-calling agent:

```ts
async function runAgentLoop(
  messages: AnthropicBedrock.MessageParam[],
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

    if (response.stop_reason === "end_turn") {
      return response.content
        .filter((b): b is AnthropicBedrock.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }

    if (response.stop_reason === "tool_use") {
      currentMessages.push({ role: "assistant", content: response.content });
      const results: AnthropicBedrock.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`🔧 Tool: ${block.name}`, block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await executeTool(block.name, block.input),
        });
      }
      currentMessages.push({ role: "user", content: results });
    }
  }
}
```

---

## Block E — Update the system prompt

**Replace** the `SYSTEM_PROMPT` constant with:

```ts
const SYSTEM_PROMPT = `You are a virtual customer support assistant for CorpBank.
Be friendly, clear, and concise. Always reply in English.

You have access to tools to query real customer data:
- identify_customer: identify the customer by name + phone
- get_accounts: all account balances
- get_bills: bills and invoices (open or paid)
- request_loan: submit a loan request

RULES:
1. When the customer provides their name and phone number, call identify_customer immediately.
   Providing name and phone is sufficient — do not ask them to log in anywhere.
2. Use tools to answer questions about financial data — never make up numbers.
3. Loans up to $500 are approved automatically. Above that, inform the customer
   it requires human approval and use request_loan anyway to register the request.
4. If the customer asks to speak with a human, signal redirect_to_agent.

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

## Block F — Update the POST handler

**Replace** the `try` block inside `POST` with:

```ts
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
        response: "Sorry, something went wrong. Please try again.",
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

## Test

Send: `"Hi, check my balance. My name is Alice Johnson and my phone is +1-555-0101"`

Watch the terminal — you will see:
```
🔧 Tool: identify_customer { name: 'Alice Johnson', phone: '+1-555-0101' }
🔧 Tool: get_accounts { customer_id: 'cust_001' }
```

## Discussion points

- **Why a loop?** Claude may call multiple tools before answering. The loop keeps running until `stop_reason === "end_turn"`.
- **Why does tool description matter?** Claude reads it to decide WHEN to call the tool — a bad description = wrong or missing calls.
- **What happens with loan > $500?** The DB registers it as `pending`. Step 4 handles the human approval.

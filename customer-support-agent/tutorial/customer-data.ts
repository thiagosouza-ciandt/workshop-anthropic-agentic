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

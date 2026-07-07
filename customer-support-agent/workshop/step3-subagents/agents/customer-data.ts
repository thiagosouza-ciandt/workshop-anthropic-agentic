// ============================================================
// Subagente: Customer Data
// ============================================================
// Responsibility: everything related to the customer profile and accounts.
// Tools: get_customer, get_accounts, get_transactions
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

const tools: AnthropicBedrock.Tool[] = [
  {
    name: "get_customer",
    description: "Fetches the full customer profile: name, plan, credit limit.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "get_accounts",
    description: "Returns all customer accounts with current balance (checking, savings, credit).",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
      },
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
      case "get_customer":
        return JSON.stringify(await db(`/customers/${input.customer_id}`));
      case "get_accounts":
        return JSON.stringify(await db(`/accounts/${input.customer_id}`));
      case "get_transactions":
        return JSON.stringify(
          await db(`/transactions/${input.account_id}?limit=${input.limit ?? 10}`)
        );
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the customer data specialist agent for CorpBank.
Your sole responsibility is to fetch and summarize information about the customer's profile and accounts.
Use the available tools to answer — never make up data.
Respond concisely in English, with only the requested data.`;

export async function runCustomerDataAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("👤 CustomerDataAgent started:", task);
  const messages: AnthropicBedrock.MessageParam[] = [
    { role: "user", content: task },
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b): b is AnthropicBedrock.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");
      console.log("👤 CustomerDataAgent finished");
      return text;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: AnthropicBedrock.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`  🔧 [CustomerData] ${block.name}`, block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await executeTool(block.name, block.input),
        });
      }
      messages.push({ role: "user", content: results });
    }
  }
}

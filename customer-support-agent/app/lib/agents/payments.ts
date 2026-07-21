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
   - Politely decline and explain the amount is above their credit limit.
   - Signal that needs_human_approval=true so the coordinator can offer escalation.
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

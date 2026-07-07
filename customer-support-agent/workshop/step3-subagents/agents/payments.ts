// ============================================================
// Subagente: Payments
// ============================================================
// Responsibility: loans and credit limit.
// Tools: request_loan, get_loans, get_credit
// ============================================================

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

const AGENT_LOAN_LIMIT = 500;

const tools: AnthropicBedrock.Tool[] = [
  {
    name: "get_credit",
    description:
      "Returns the customer's credit limit, how much has been used, and how much is available.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "get_loans",
    description: "Lists all customer loans with status (approved, pending, active).",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "request_loan",
    description: `Submits a loan request for the customer.
- Up to $${AGENT_LOAN_LIMIT}: approved automatically.
- Above $${AGENT_LOAN_LIMIT}: registered as pending and requires human approval.
Always use this tool to register the request, regardless of the amount.`,
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

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "get_credit":
        return JSON.stringify(await db(`/credit/${input.customer_id}`));
      case "get_loans":
        return JSON.stringify(await db(`/loans/${input.customer_id}`));
      case "request_loan":
        return JSON.stringify(
          await dbPost("/loans", {
            customer_id: input.customer_id,
            amount: input.amount,
          })
        );
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the loans and credit specialist agent for CorpBank.
Your responsibility is to process loan requests and check credit limits.

IMPORTANT RULES:
- Loans up to $${AGENT_LOAN_LIMIT}: approve automatically using request_loan.
- Loans above $${AGENT_LOAN_LIMIT}: use request_loan anyway (to register it),
  but clearly inform that the request will be pending human approval.
- Never promise approval for amounts above your limit.

Respond concisely in English with the request details.
Include in the return: { "loan_id": "...", "needs_human_approval": true/false }`;

export async function runPaymentsAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("💳 PaymentsAgent started:", task);
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
      console.log("💳 PaymentsAgent finished");
      return text;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: AnthropicBedrock.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`  🔧 [Payments] ${block.name}`, block.input);
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

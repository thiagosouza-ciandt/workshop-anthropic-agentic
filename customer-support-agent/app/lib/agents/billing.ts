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

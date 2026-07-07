// ============================================================
// Subagente: Billing
// ============================================================
// Responsibility: bills, invoices, and payments.
// Tools: get_bills, pay_bill
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

async function dbPost(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

const tools: AnthropicBedrock.Tool[] = [
  {
    name: "get_bills",
    description:
      "Lists customer bills and invoices. Use paid=false to see only open or overdue ones.",
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
  {
    name: "pay_bill",
    description: "Marks a bill as paid. Use the bill ID returned by get_bills.",
    input_schema: {
      type: "object" as const,
      properties: {
        bill_id: { type: "string" },
      },
      required: ["bill_id"],
    },
  },
];

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "get_bills": {
        const paidParam = input.paid !== undefined ? `?paid=${input.paid ? 1 : 0}` : "";
        return JSON.stringify(await db(`/bills/${input.customer_id}${paidParam}`));
      }
      case "pay_bill":
        return JSON.stringify(await dbPost(`/bills/${input.bill_id}/pay`));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

const SYSTEM_PROMPT = `You are the billing specialist agent for CorpBank.
Your responsibility is to look up and report on bills, invoices, and payment status.
Use the available tools — never make up data.
Respond concisely in English, highlighting amounts and due dates.`;

export async function runBillingAgent(
  anthropic: AnthropicBedrock,
  model: string,
  task: string,
): Promise<string> {
  console.log("🧾 BillingAgent started:", task);
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
      console.log("🧾 BillingAgent finished");
      return text;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: AnthropicBedrock.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`  🔧 [Billing] ${block.name}`, block.input);
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

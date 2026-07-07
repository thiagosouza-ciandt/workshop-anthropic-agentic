// ============================================================
// Coordinator Agent
// ============================================================
// Responsibility: receive the customer message, decide which
// subagents to trigger, consolidate the responses, and reply to the customer.
//
// Pattern: Orchestrator → Subagents
//   The Coordinator does NOT query the database directly.
//   It delegates to the specialists and synthesizes the results.
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import { runCustomerDataAgent } from "./customer-data";
import { runBillingAgent } from "./billing";
import { runPaymentsAgent } from "./payments";

// ── Final response schema for the frontend ───────────────────────────────────
export const responseSchema = z.object({
  thinking: z.string(),
  response: z.string(),
  user_mood: z.enum([
    "positive", "neutral", "negative",
    "curious", "frustrated", "confused",
  ]),
  suggested_questions: z.array(z.string()),
  redirect_to_agent: z.object({
    should_redirect: z.boolean(),
    reason: z.string().optional(),
  }),
  debug: z.object({ context_used: z.boolean() }),
  // Orchestration metadata — visible in the backoffice (Step 4)
  orchestration: z.object({
    agents_called: z.array(z.string()),
    needs_human_approval: z.boolean().optional(),
    loan_id: z.string().optional(),
    conversation_id: z.string().optional(),
  }).optional(),
});

export type CoordinatorResponse = z.infer<typeof responseSchema>;

// ── Coordinator Tools ─────────────────────────────────────────────────────────
// The Coordinator does not query the database — it "calls" subagents as tools.
// This keeps each specialist isolated and individually testable.
function buildCoordinatorTools(
  anthropic: AnthropicBedrock,
  model: string,
): { tools: AnthropicBedrock.Tool[]; executor: (name: string, input: any) => Promise<string> } {
  const tools: AnthropicBedrock.Tool[] = [
    {
      name: "delegate_customer_data",
      description:
        "Delegates to the customer data agent. Use for: profile lookup, account balances, transaction history.",
      input_schema: {
        type: "object" as const,
        properties: {
          task: {
            type: "string",
            description: "Complete instruction for the subagent, including the customer_id.",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "delegate_billing",
      description:
        "Delegates to the billing agent. Use for: open bills, overdue invoices, marking payments.",
      input_schema: {
        type: "object" as const,
        properties: {
          task: {
            type: "string",
            description: "Complete instruction for the subagent, including the customer_id.",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "delegate_payments",
      description:
        "Delegates to the payments and credit agent. Use for: loan requests, credit limit checks, loan history.",
      input_schema: {
        type: "object" as const,
        properties: {
          task: {
            type: "string",
            description: "Complete instruction for the subagent, including the customer_id.",
          },
        },
        required: ["task"],
      },
    },
  ];

  async function executor(name: string, input: any): Promise<string> {
    switch (name) {
      case "delegate_customer_data":
        return runCustomerDataAgent(anthropic, model, input.task);
      case "delegate_billing":
        return runBillingAgent(anthropic, model, input.task);
      case "delegate_payments":
        return runPaymentsAgent(anthropic, model, input.task);
      default:
        return JSON.stringify({ error: `Unknown subagent: ${name}` });
    }
  }

  return { tools, executor };
}

// ── Coordinator System Prompt ─────────────────────────────────────────────────
function buildSystemPrompt(customerId: string | null): string {
  return `You are the Coordinator Agent for CorpBank — the central customer support hub.
Your role is to understand the request, delegate to the right subagents, and synthesize the response.

${customerId ? `Identified customer: ${customerId}` : "Customer not identified — ask for customer_id or email."}

AVAILABLE SUBAGENTS:
- delegate_customer_data: profile, balances, statement
- delegate_billing: bills, invoices, payments
- delegate_payments: loans, credit limit

RULES:
1. Always include the customer_id in the instructions you pass to subagents.
2. You may call more than one subagent if the request spans multiple domains.
3. Synthesize the subagent responses into a single clear reply to the customer.
4. If a loan requires human approval (returned by the payments subagent),
   include needs_human_approval: true and the loan_id in the orchestration field.
5. If the customer asks to speak with a human, signal redirect_to_agent.

IMPORTANT: Always respond as valid JSON:
{
  "thinking": "your reasoning: which subagents to call and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true },
  "orchestration": {
    "agents_called": ["customer_data", "billing"],
    "needs_human_approval": false
  }
}`;
}

// ── JSON Parser ───────────────────────────────────────────────────────────────
function parseJSON(text: string) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : stripped);
}

// ── Coordinator Loop ──────────────────────────────────────────────────────────
export async function runCoordinator(
  anthropic: AnthropicBedrock,
  model: string,
  messages: AnthropicBedrock.MessageParam[],
  customerId: string | null,
): Promise<CoordinatorResponse> {
  console.log("🎯 Coordinator started");

  const { tools, executor } = buildCoordinatorTools(anthropic, model);
  const currentMessages = [...messages];

  while (true) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: buildSystemPrompt(customerId),
      tools,
      messages: currentMessages,
    });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b): b is AnthropicBedrock.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");

      console.log("🎯 Coordinator finished");
      const parsed = parseJSON(text);
      return responseSchema.parse(parsed);
    }

    if (response.stop_reason === "tool_use") {
      currentMessages.push({ role: "assistant", content: response.content });

      const results: AnthropicBedrock.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        console.log(`  📡 [Coordinator] delegating to: ${block.name}`);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await executor(block.name, block.input),
        });
      }

      currentMessages.push({ role: "user", content: results });
    }
  }
}

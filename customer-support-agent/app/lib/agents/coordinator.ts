// Coordinator — routes requests to specialist agents and synthesizes the response.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import { runCustomerDataAgent } from "./customer-data";
import { runBillingAgent } from "./billing";
import { runPaymentsAgent } from "./payments";
import { searchDocs } from "./mcp-docs";

// ── Response schema — validated before returning to the frontend ───────────────
export const responseSchema = z.object({
  thinking: z.string(),
  response: z.string(),
  user_mood: z.enum(["positive", "neutral", "negative", "curious", "frustrated", "confused"]),
  suggested_questions: z.array(z.string()),
  redirect_to_agent: z.object({
    should_redirect: z.boolean(),
    reason: z.string().optional(),
  }),
  debug: z.object({ context_used: z.boolean() }),
  orchestration: z.object({
    agents_called: z.array(z.string()),
    needs_human_approval: z.boolean().optional(),
    loan_id: z.string().optional(),
  }).optional(),
});

export type CoordinatorResponse = z.infer<typeof responseSchema>;

export type EscalationInput = {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  reason: string;
  loan_id?: string;
};

export type CoordinatorResult = {
  response: CoordinatorResponse;
  escalation: EscalationInput | null;
};

// ── JSON parser — strips markdown fences ──────────────────────────────────────
function parseJSON(text: string) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  return {
    thinking: "Claude responded in plain text — wrapped as fallback.",
    response: text.trim(),
    user_mood: "neutral",
    suggested_questions: [],
    redirect_to_agent: { should_redirect: false },
    debug: { context_used: false },
  };
}

// ── Coordinator system prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Coordinator Agent for CorpBank.
Understand the customer's request and delegate to the right specialist agent.

IDENTITY RULE — most important:
When the customer provides their full name and phone number, that is ALL that is needed
for identification. NEVER ask the customer for a Customer ID, account number, or any
other credential. The specialists resolve the Customer ID internally from name + phone.

AGENTS AVAILABLE:
- delegate_customer_data: identity, account balances, transaction history
- delegate_billing: bills, invoices, payment due dates
- delegate_payments: loan applications, credit limits
- search_docs: CorpBank internal policy documents (rates, fees, eligibility, products)
- escalate_to_human: transfer the conversation to a human agent

DELEGATION RULES:
1. As soon as the customer provides name + phone, delegate immediately — do not ask for more.
2. Always pass the customer's name, phone, and full question to the delegate.
3. For billing and payments tasks: first call delegate_customer_data to resolve the
   customer_id, then include that customer_id when calling delegate_billing or
   delegate_payments so they don't need to re-identify.
4. You may call more than one agent if the request spans multiple domains.
5. Synthesize all agent responses into a single coherent reply for the customer.
6. If the payments agent signals needs_human_approval=true, ask the customer whether
   they want to be transferred to a human agent. If they confirm → call escalate_to_human.

ESCALATION RULES:
- Only escalate when: (a) loan > $500 confirmed by customer, or (b) customer explicitly
  demands to speak with a human immediately.
- Do NOT escalate for credit limit questions, complaints, or routine inquiries.

POST-LOAN RESPONSE RULES:
After any loan outcome (approved, pending, or denied), always include in suggested_questions:
- One option to continue ("Is there anything else I can help you with?")
- One option to close ("No, that's all — thank you!")
- One contextually relevant follow-up (e.g. "What are my current account balances?" or
  "How long does human approval usually take?")
Never leave suggested_questions empty after a loan decision.

IMPORTANT: Always respond as valid JSON:
{
  "thinking": "which agents you called and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true },
  "orchestration": { "agents_called": ["customer_data", "billing"] }
}`;

// ── runCoordinator ─────────────────────────────────────────────────────────────
export async function runCoordinator(
  anthropic: AnthropicBedrock,
  model: string,
  messages: any[],
): Promise<CoordinatorResult> {
  console.log("[Coordinator] started");

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
  ];

  let escalation: EscalationInput | null = null;

  const executor = async (name: string, input: any): Promise<string> => {
    switch (name) {
      case "delegate_customer_data":
        return runCustomerDataAgent(anthropic, model, input.task);
      case "delegate_billing":
        return runBillingAgent(anthropic, model, input.task);
      case "delegate_payments":
        return runPaymentsAgent(anthropic, model, input.task);
      case "search_docs":
        return searchDocs(input.query);
      case "escalate_to_human":
        escalation = input as EscalationInput;
        return JSON.stringify({ escalated: true });
      default:
        return JSON.stringify({ error: `Unknown agent: ${name}` });
    }
  };

  const currentMessages = [...messages];

  while (true) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    if (res.stop_reason === "end_turn") {
      const text = res.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join(" ");
      console.log("[Coordinator] done");
      return { response: responseSchema.parse(parseJSON(text)), escalation };
    }

    currentMessages.push({ role: "assistant", content: res.content });

    const results: any[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`  [Coordinator] -> ${block.name}`);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await executor(block.name, block.input),
      });
    }
    currentMessages.push({ role: "user", content: results });
  }
}

// ============================================================
// WORKSHOP — Step 2: Tool Calling
// ============================================================
// What this step adds (compared to Step 1):
//   • Tool definition for Claude
//   • Agentic loop: Claude calls tools → we receive the result → Claude continues
//   • Real queries to CorpDB (SQLite via REST API)
//
// What is NOT here yet:
//   • Specialized subagents
//   • Human-in-the-loop
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import crypto from "crypto";
import { publish, getConvCustomer, setConvCustomer } from "@/app/lib/sse-store";
import { searchDocs } from "@/app/lib/mcp-docs";

// Allowlist for customer IDs — must match DB pattern to prevent prompt injection
const CUSTOMER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type MessageParam = Parameters<InstanceType<typeof AnthropicBedrock>["messages"]["create"]>[0]["messages"][number];
type ToolResultBlockParam = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

const anthropic = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
});

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

// ── 1. Helpers to call the database API ──────────────────────────────────────
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

// ── 2. Tool definitions ───────────────────────────────────────────────────────
// Each tool has:
//   • name: identifier that Claude uses to call it
//   • description: Claude reads this to decide WHEN to use the tool
//   • input_schema: the parameters Claude must pass
const tools: Parameters<InstanceType<typeof AnthropicBedrock>["messages"]["create"]>[0]["tools"] = [
  // ── STEP 2: identification tool ──────────────────────────────────────────────
  // Call this tool as soon as the customer provides their name and phone number.
  // It returns the customer_id that the other tools need.
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
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "get_customer",
    description:
      "Fetches the customer profile by ID. Use to confirm who the customer is before any financial query.",
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
    description:
      "Returns all customer accounts (checking, savings, credit) with current balance.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
      },
      required: ["customer_id"],
    },
  },
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
  {
    name: "get_credit",
    description:
      "Returns the customer's credit limit (USD), how much has been used, and how much is available. Use when the customer asks about their credit limit.",
    input_schema: {
      type: "object" as const,
      properties: { customer_id: { type: "string" } },
      required: ["customer_id"],
    },
  },
  {
    name: "request_loan",
    description:
      "Submits a loan request for the customer. Loans up to $500 are approved automatically. Above that they stay pending for human approval.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
        amount: { type: "number", description: "Amount in USD" },
      },
      required: ["customer_id", "amount"],
    },
  },
  {
    name: "search_docs",
    description:
      "Searches CorpBank's internal policy documents. Use when the customer asks about rates, fees, policies, eligibility, products, or any question that requires official documentation rather than live account data.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Keywords to search for, e.g. 'loan interest rate' or 'credit limit increase'" },
      },
      required: ["query"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Transfers the conversation to a human agent. Use in two cases: (1) loan above $500 after customer confirms transfer, or (2) customer is clearly frustrated and demands a human immediately. Do NOT use for credit limit increases, complaints, disputes, or routine questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_id: { type: "string" },
        customer_name: { type: "string" },
        reason: { type: "string", description: "Why the handoff is needed" },
        loan_id: { type: "string", description: "Loan ID if this is a loan escalation" },
      },
      required: ["customer_id", "customer_name", "reason"],
    },
  },
];

// ── 3. Tool Executor ──────────────────────────────────────────────────────────
// Receives the name and inputs Claude chose, executes them, and returns the result.
async function executeTool(name: string, input: any): Promise<string> {
  try {
    let result: any;

    switch (name) {
      // ── STEP 2: identification tool executor ────────────────────────────────
      case "identify_customer":
        result = await db(
          `/customers/identify?name=${encodeURIComponent(input.name)}&phone=${encodeURIComponent(input.phone)}`
        );
        break;
      // ────────────────────────────────────────────────────────────────────────

      case "get_customer":
        result = await db(`/customers/${input.customer_id}`);
        break;

      case "get_accounts":
        result = await db(`/accounts/${input.customer_id}`);
        break;

      case "get_bills":
        const paidParam = input.paid !== undefined ? `?paid=${input.paid ? 1 : 0}` : "";
        result = await db(`/bills/${input.customer_id}${paidParam}`);
        break;

      case "get_transactions":
        const limit = input.limit ?? 10;
        result = await db(`/transactions/${input.account_id}?limit=${limit}`);
        break;

      case "get_credit":
        result = await db(`/credit/${input.customer_id}`);
        break;

      case "request_loan":
        result = await dbPost("/loans", {
          customer_id: input.customer_id,
          amount: input.amount,
        });
        break;

      case "search_docs":
        result = await searchDocs(input.query);
        break;

      case "escalate_to_human":
        // Handled in the main handler after the loop — signal back to POST
        result = { escalated: true, ...input };
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    return JSON.stringify(result);
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

// ── 4. Final Response Schema ──────────────────────────────────────────────────
const responseSchema = z.object({
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
  handoff_initiated: z.boolean().optional(),
});

// ── 5. System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a virtual customer support assistant for CorpBank.
Be friendly, clear, and concise. Always reply in English.

You have access to tools to query real customer data and internal documents:
- identify_customer: identify the customer by name + phone
- get_customer: customer profile by ID
- get_accounts: all account balances
- get_bills: bills and invoices (open or paid)
- get_transactions: account statement
- get_credit: credit limit and availability
- request_loan: submit a loan request
- search_docs: search CorpBank policy documents (rates, fees, eligibility, products)
- escalate_to_human: transfer the conversation to a human agent

RULES:
1. When the customer provides their name and phone number, call identify_customer immediately.
   Providing name and phone is sufficient — do not ask them to log in anywhere.
2. Use tools to answer questions about financial data — never make up numbers.
3. For loan requests — follow this sequence exactly:
   a. Call get_credit to check the customer's credit limit.
   b. If the requested amount exceeds credit_limit_usd:
      - Do NOT call request_loan.
      - Politely decline: explain the amount is above their credit limit.
      - Offer to escalate to a human agent who can review an exception.
      - If the customer confirms escalation → call escalate_to_human (without a loan_id).
   c. If the requested amount is within credit_limit_usd AND above $500:
      - Call request_loan to register it as pending.
      - Inform the customer it requires human approval.
      - Ask if they want to be transferred now.
      - If confirmed → call escalate_to_human with the loan_id.
   d. If the requested amount is within credit_limit_usd AND $500 or below:
      - Call request_loan — it will be approved automatically.
4. You may escalate to a human in two situations only:
   a. Loan requests — as described in rule 3 above.
   b. Customer expresses strong frustration and explicitly demands to speak with a human
      immediately — escalate right away without asking for further confirmation.
5. For everything else that requires approval (credit limit increases, disputes, complaints,
   account changes), respond politely that you do not have the authority to handle that,
   and suggest the customer visit a branch or call the support line.
6. Never call escalate_to_human for routine questions or topics you can answer yourself.

IMPORTANT: Always respond as a valid JSON object:
{
  "thinking": "internal reasoning — what you queried and why",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Question 1?", "Question 2?"],
  "redirect_to_agent": { "should_redirect": false },
  "debug": { "context_used": true }
}`;

// ── 6. Parser JSON ────────────────────────────────────────────────────────────
function parseJSON(text: string) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : stripped);
}

// ── 7. Agentic loop ───────────────────────────────────────────────────────────
type LoopResult = { text: string; escalation: any | null; customerId: string | null };

async function runAgentLoop(
  messages: MessageParam[],
  model: string,
  knownCustomerId: string | null,
): Promise<LoopResult> {
  let currentMessages = [...messages];
  let escalation: any | null = null;
  let customerId: string | null = knownCustomerId;

  while (true) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: knownCustomerId && CUSTOMER_ID_RE.test(knownCustomerId)
        ? SYSTEM_PROMPT + `\n\nCustomer already identified: ${knownCustomerId}. Do NOT call identify_customer again.`
        : SYSTEM_PROMPT,
      tools,
      messages: currentMessages,
    });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join(" ");
      return { text, escalation, customerId };
    }

    if (response.stop_reason === "tool_use") {
      currentMessages.push({ role: "assistant", content: response.content });

      const toolResults: ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`🔧 Tool call: ${block.name}`, block.input);
        const result = await executeTool(block.name, block.input);
        console.log(`✅ Tool result: ${block.name}`, result.slice(0, 200));

        // Capture customer_id when identified so we can return it to the frontend
        if (block.name === "identify_customer") {
          try { customerId = JSON.parse(result)?.id ?? customerId; } catch {}
        }

        if (block.name === "escalate_to_human") {
          escalation = block.input;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      currentMessages.push({ role: "user", content: toolResults });
    }
  }
}

// ── 8. Main Handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { messages, model, conversationId = crypto.randomUUID() } = await req.json();
  // Never trust customerId from the client — look it up server-side by conversationId
  const customerId = getConvCustomer(conversationId);

  const anthropicMessages: MessageParam[] = messages.map(
    (msg: any) => ({ role: msg.role, content: msg.content }),
  );

  try {
    const { text, escalation, customerId: resolvedCustomerId } = await runAgentLoop(
      anthropicMessages,
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      customerId,
    );

    // Persist newly resolved customerId server-side for subsequent requests
    if (resolvedCustomerId && !customerId) {
      setConvCustomer(conversationId, resolvedCustomerId);
    }

    const parsed = parseJSON(text);
    const validated = responseSchema.parse(parsed);

    // ── Handoff: create in DB and notify backoffice via SSE ──────────────────
    if (escalation) {
      // Deduplicate: skip if a waiting/claimed handoff already exists for this conversation
      const existing = await fetch(`${CORPDB_URL}/handoffs?status=waiting`)
        .then((r) => r.ok ? r.json() : []).catch(() => []);
      const alreadyOpen = existing.some((h: any) => h.conversation_id === conversationId);
      if (alreadyOpen) {
        console.log(`⚠️ Handoff already open for ${conversationId} — skipping duplicate`);
        return Response.json({
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          customer_id: resolvedCustomerId,
          handoff_initiated: true,
          ...validated,
        });
      }

      const customer = await fetch(`${CORPDB_URL}/customers/${escalation.customer_id}`)
        .then((r) => r.ok ? r.json() : null).catch(() => null);

      const handoff = await dbPost("/handoffs", {
        conversation_id: conversationId,
        customer_id: escalation.customer_id,
        loan_id: escalation.loan_id ?? null,
        context: {
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
          agent_reasoning: escalation.reason,
          customer_summary: customer
            ? `${customer.name} | Credit limit: $${customer.credit_limit_usd}`
            : escalation.customer_name ?? "Unknown customer",
        },
      });

      publish("*", {
        type: "handoff_created",
        payload: {
          handoff_id: handoff.id,
          conversation_id: conversationId,
          customer_id: escalation.customer_id,
          customer_name: escalation.customer_name ?? customer?.name ?? "Unknown",
          loan_id: escalation.loan_id ?? "",
          amount: 0,
          context: handoff.context ?? {},
        },
      });

      console.log(`🚨 Handoff created: ${handoff.id}`);
    }

    return Response.json({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      customer_id: resolvedCustomerId,
      handoff_initiated: !!escalation,
      ...validated,
    });
  } catch (error) {
    console.error("Agent error:", error);
    return Response.json(
      {
        response: "Sorry, an error occurred. Please try again.",
        thinking: "Internal error.",
        user_mood: "neutral",
        suggested_questions: [],
        redirect_to_agent: { should_redirect: false },
        debug: { context_used: false },
      },
      { status: 500 },
    );
  }
}

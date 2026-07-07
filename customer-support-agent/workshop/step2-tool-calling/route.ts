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
// Types are referenced via the AnthropicBedrock namespace below (e.g. AnthropicBedrock.Tool).
// This works at runtime inside Next.js — the IDE may show false positives for this pattern.
import { z } from "zod";
import crypto from "crypto";

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
const tools: AnthropicBedrock.Tool[] = [
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

      case "request_loan":
        result = await dbPost("/loans", {
          customer_id: input.customer_id,
          amount: input.amount,
        });
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
});

// ── 5. System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a virtual customer support assistant for CorpBank.
Be friendly, clear, and concise. Always reply in English.

You have access to tools to query real customer data:
- identify_customer: identify the customer by name + phone
- get_customer: customer profile by ID
- get_accounts: all account balances
- get_bills: bills and invoices (open or paid)
- get_transactions: account statement
- request_loan: submit a loan request

RULES:
1. When the customer provides their name and phone number, call identify_customer immediately.
   Providing name and phone is sufficient — do not ask them to log in anywhere.
2. Use tools to answer questions about financial data — never make up numbers.
3. Loans up to $500 are approved by you automatically. Above that, inform the customer
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
// This is the main difference compared to Step 1.
// The loop continues as long as Claude wants to call tools.
// It only ends when stop_reason === "end_turn".
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

    // Claude finished — return the final text
    if (response.stop_reason === "end_turn") {
      return response.content
        .filter((b): b is AnthropicBedrock.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }

    // Claude wants to call tools
    if (response.stop_reason === "tool_use") {
      // Add Claude's response (with tool_use blocks) to the history
      currentMessages.push({ role: "assistant", content: response.content });

      // Execute each tool called by Claude
      const toolResults: AnthropicBedrock.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`🔧 Tool call: ${block.name}`, block.input);
        const result = await executeTool(block.name, block.input);
        console.log(`✅ Tool result: ${block.name}`, result.slice(0, 200));

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      // Return the tool results to Claude to continue
      currentMessages.push({ role: "user", content: toolResults });
    }
  }
}

// ── 8. Main Handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { messages, model } = await req.json();

  const anthropicMessages: AnthropicBedrock.MessageParam[] = messages.map(
    (msg: any) => ({ role: msg.role, content: msg.content }),
  );

  try {
    const text = await runAgentLoop(
      anthropicMessages,
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );

    const parsed = parseJSON(text);
    const validated = responseSchema.parse(parsed);

    return Response.json({ id: crypto.randomUUID(), ...validated });
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

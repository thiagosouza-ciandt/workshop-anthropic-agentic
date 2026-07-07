// ============================================================
// WORKSHOP — Step 1: Base Agent
// ============================================================
// What this step teaches:
//   • How to call Claude via Amazon Bedrock
//   • How to use a system prompt to give the agent an identity
//   • How to force structured output (JSON) via prompt
//   • How to validate the response with Zod
//
// What is NOT here yet (comes in the next steps):
//   • Tool calling / database queries
//   • Specialized subagents
//   • Human-in-the-loop
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";
import crypto from "crypto";

// ── 1. Bedrock Client ────────────────────────────────────────────────────────
// Authenticates via IAM Role — no keys in the code.
// AWS_REGION comes from .env.local (default: us-east-1)
const anthropic = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
});

// ── 2. Response Schema ────────────────────────────────────────────────────────
// Zod validates that Claude always returns the format expected by the frontend.
// If any field is missing, the route throws an error before responding.
const responseSchema = z.object({
  thinking: z.string(),           // agent's internal reasoning (visible in the backoffice)
  response: z.string(),           // message shown to the customer
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

// ── 3. System prompt ──────────────────────────────────────────────────────────
// Defines the agent identity and scope.
const SYSTEM_PROMPT = `You are a virtual customer support assistant for CorpBank.
Be friendly, clear, and concise. Always reply in English.

You can help with:
- Account balance and transaction history
- Bills and invoices
- Loan requests
- Credit limit increases
- General questions about bank products

IMPORTANT RULES:
- You do NOT have access to customer data yet — you cannot look up balances, bills, or loans.
- Never ask the customer to log in, use an app, or go through any authentication process.
- When the customer asks for account data, acknowledge their request warmly and let them know
  this capability is coming — do not invent security policies or redirect them elsewhere.
- If the customer explicitly asks to speak with a human, signal a redirection.

IMPORTANT: Always respond as a valid JSON object in exactly this format:
{
  "thinking": "your internal reasoning about how to respond",
  "response": "your response to the customer",
  "user_mood": "positive|neutral|negative|curious|frustrated|confused",
  "suggested_questions": ["Suggested question 1?", "Suggested question 2?"],
  "redirect_to_agent": {
    "should_redirect": false
  },
  "debug": {
    "context_used": false
  }
}`;

// ── 4. JSON Parser ────────────────────────────────────────────────────────────
// Claude sometimes wraps JSON in markdown (```json ... ```).
// This function removes the wrapper and extracts the object.
function parseJSON(text: string) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : stripped);
}

// ── 5. Main Handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { messages, model } = await req.json();

  // Maps the history to the SDK format
  const anthropicMessages = messages.map((msg: any) => ({
    role: msg.role,
    content: msg.content,
  }));

  try {
    // Call to Claude via Bedrock
    const response = await anthropic.messages.create({
      model: model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages,
    });

    // Extract the response text
    const text = response.content
      .filter((b): b is AnthropicBedrock.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ");

    // Validate and return
    const parsed = parseJSON(text);
    const validated = responseSchema.parse(parsed);

    return Response.json({ id: crypto.randomUUID(), ...validated });
  } catch (error) {
    console.error("Generation error:", error);
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

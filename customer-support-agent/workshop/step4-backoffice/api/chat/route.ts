// ============================================================
// WORKSHOP — Step 4: Updated route.ts
// ============================================================
// What changes compared to Step 3:
//   • After the Coordinator response, checks needs_human_approval
//   • If true: creates a handoff in CorpDB and publishes an SSE event
//   • Returns conversation_id to the frontend (so the chat can open SSE)
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import crypto from "crypto";
import { runCoordinator } from "../step3-subagents/agents/coordinator";
// In production: import { runCoordinator } from "@/app/lib/agents/coordinator";
import { publish } from "@/workshop/step4-backoffice/lib/sse-store";
// In production: import { publish } from "@/app/lib/sse-store";

const anthropic = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
});

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function dbPost(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

async function db(path: string) {
  const res = await fetch(`${CORPDB_URL}${path}`);
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

export async function POST(req: Request) {
  // conversation_id persists across requests of the same conversation
  // The frontend generates a UUID on the first message and reuses it for subsequent ones
  const {
    messages,
    model,
    customerId = null,
    conversationId = crypto.randomUUID(),
  } = await req.json();

  const anthropicMessages: AnthropicBedrock.MessageParam[] = messages.map(
    (msg: any) => ({ role: msg.role, content: msg.content }),
  );

  try {
    const result = await runCoordinator(
      anthropic,
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      anthropicMessages,
      customerId,
    );

    // ── Automatic handoff when loan > $500 ──────────────────────────────────
    if (result.orchestration?.needs_human_approval && result.orchestration.loan_id) {
      const { loan_id } = result.orchestration;

      // Fetch customer data to enrich the backoffice context
      const customer = customerId ? await db(`/customers/${customerId}`).catch(() => null) : null;

      // Create the handoff in the database
      const handoff = await dbPost("/handoffs", {
        conversation_id: conversationId,
        customer_id: customerId,
        loan_id,
        context: {
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
          agent_reasoning: result.thinking,
          customer_summary: customer
            ? `${customer.name} | Credit limit: $${customer.credit_limit_usd}`
            : "Customer not identified",
        },
      });

      // Publish to the global channel so the backoffice receives it in real time
      publish("*", {
        type: "handoff_created",
        payload: {
          handoff_id: handoff.id,
          conversation_id: conversationId,
          customer_id: customerId ?? "",
          customer_name: customer?.name ?? "Unknown",
          loan_id,
          amount: 0, // o backoffice busca pelo loan_id se precisar
          context: handoff.context ?? {},
        },
      });

      console.log(`🚨 Handoff created: ${handoff.id} | loan: ${loan_id}`);
    }

    return Response.json({
      id: crypto.randomUUID(),
      conversation_id: conversationId, // frontend stores this for SSE and subsequent requests
      ...result,
    });
  } catch (error) {
    console.error("Coordinator error:", error);
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

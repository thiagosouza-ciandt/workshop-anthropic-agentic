// Chat API route — thin wrapper: receives the request, runs the coordinator, handles handoffs.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import crypto from "crypto";
import { publish } from "@/app/lib/sse-store";
import { runCoordinator } from "@/app/lib/agents/coordinator";

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

export async function POST(req: Request) {
  const { messages, model, conversationId = crypto.randomUUID() } = await req.json();

  try {
    const { response: result, escalation } = await runCoordinator(
      anthropic,
      model ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      messages.map((msg: any) => ({ role: msg.role, content: msg.content })),
    );

    // ── Handoff: persist in DB and push SSE event to the backoffice ──────────
    if (escalation) {
      const existing = await fetch(`${CORPDB_URL}/handoffs?status=waiting`)
        .then((r) => r.ok ? r.json() : []).catch(() => []);
      const alreadyOpen = existing.some((h: any) => h.conversation_id === conversationId);

      if (alreadyOpen) {
        console.log(`[Handoff] already open for ${conversationId} — skipping duplicate`);
      } else {
        // Resolve the customer record — prefer the ID the coordinator supplied,
        // but fall back to name+phone lookup if the ID is missing or invalid.
        let customer = escalation.customer_id
          ? await fetch(`${CORPDB_URL}/customers/${escalation.customer_id}`)
              .then((r) => r.ok ? r.json() : null).catch(() => null)
          : null;

        if (!customer && escalation.customer_name && escalation.customer_phone) {
          customer = await fetch(
            `${CORPDB_URL}/customers/identify?name=${encodeURIComponent(escalation.customer_name)}&phone=${encodeURIComponent(escalation.customer_phone)}`
          ).then((r) => r.ok ? r.json() : null).catch(() => null);
        }

        if (!customer) {
          console.error("[Handoff] cannot create — customer not resolved. customer_id:", escalation.customer_id ?? "(missing)", "loan_id:", escalation.loan_id ?? "(missing)");
          return Response.json({
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            handoff_initiated: false,
            ...result,
          });
        }

        const handoff = await dbPost("/handoffs", {
          conversation_id: conversationId,
          customer_id: customer.id,
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
            customer_id: customer.id,
            customer_name: customer.name ?? escalation.customer_name ?? "Unknown",
            loan_id: escalation.loan_id ?? "",
            amount: 0,
            context: handoff.context ?? {},
          },
        });

        console.log(`[Handoff] created: ${handoff.id}`);
      }
    }

    return Response.json({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      handoff_initiated: !!escalation,
      ...result,
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

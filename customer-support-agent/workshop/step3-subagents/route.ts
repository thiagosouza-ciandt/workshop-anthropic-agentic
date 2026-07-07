// ============================================================
// WORKSHOP — Step 3: Subagents
// ============================================================
// What this step adds (compared to Step 2):
//   • Coordinator Agent: orchestrates specialized subagents
//   • CustomerDataAgent, BillingAgent, PaymentsAgent
//   • The route.ts becomes just the HTTP entry point
//   • Each subagent has its own loop, tools, and system prompt
//
// New files:
//   agents/coordinator.ts
//   agents/customer-data.ts
//   agents/billing.ts
//   agents/payments.ts
// ============================================================

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import crypto from "crypto";
import { runCoordinator } from "./agents/coordinator";

const anthropic = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
});

export async function POST(req: Request) {
  // The frontend can send customer_id when the customer identifies themselves.
  // For now, it can be null — the Coordinator will request identification.
  const { messages, model, customerId = null } = await req.json();

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

    return Response.json({ id: crypto.randomUUID(), ...result });
  } catch (error) {
    console.error("Coordinator error:", error);
    return Response.json(
      {
        response: "Sorry, an error occurred. Please try again.",
        thinking: "Internal error in Coordinator.",
        user_mood: "neutral",
        suggested_questions: [],
        redirect_to_agent: { should_redirect: false },
        debug: { context_used: false },
      },
      { status: 500 },
    );
  }
}

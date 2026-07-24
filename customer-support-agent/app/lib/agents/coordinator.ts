// Coordinator stub — workshop starting point.
//
// Steps 1 and 2: this stub calls Claude directly (no tools, no specialist agents).
//   The app works and returns real responses from the start.
//
// Steps 3 and 4: replace this file with the full coordinator from WORKSHOP_STEPS.md.
//   The coordinator will delegate to specialist agents and gain tool-calling capabilities.

import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { z } from "zod";

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

function parseJSON(text: string) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  return {
    thinking: "Claude responded in plain text.",
    response: text.trim(),
    user_mood: "neutral",
    suggested_questions: [],
    redirect_to_agent: { should_redirect: false },
    debug: { context_used: false },
  };
}

const SYSTEM_PROMPT = `You are a helpfull assintant`;

export async function runCoordinator(
  anthropic: AnthropicBedrock,
  model: string,
  messages: any[],
): Promise<CoordinatorResult> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join(" ");

  return {
    response: responseSchema.parse(parseJSON(text)),
    escalation: null,
  };
}

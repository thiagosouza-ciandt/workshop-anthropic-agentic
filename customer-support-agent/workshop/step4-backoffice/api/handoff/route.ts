// ============================================================
// POST /api/handoff   — human sends a message to the customer
// PATCH /api/handoff  — human resolves the loan (approve/reject)
// ============================================================

import { publish } from "@/workshop/step4-backoffice/lib/sse-store";
// In production: import { publish } from "@/app/lib/sse-store";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function dbPatch(path: string, body: object) {
  const res = await fetch(`${CORPDB_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
}

// POST /api/handoff
// Human agent sends a message to the customer during the handoff
// Body: { conversation_id, message, from }
export async function POST(req: Request) {
  const { conversation_id, message, from = "Human agent" } = await req.json();

  if (!conversation_id || !message) {
    return Response.json({ error: "conversation_id and message are required" }, { status: 400 });
  }

  // Publishes to the conversation channel — the customer's ChatArea receives it via SSE
  publish(conversation_id, {
    type: "human_message",
    payload: { conversation_id, message, from },
  });

  return Response.json({ success: true });
}

// PATCH /api/handoff
// Human approves or rejects the loan and resolves the handoff
// Body: { handoff_id, loan_id, conversation_id, decision, resolved_by, reason? }
export async function PATCH(req: Request) {
  const {
    handoff_id,
    loan_id,
    conversation_id,
    decision,
    resolved_by = "human",
    reason,
  } = await req.json();

  if (!handoff_id || !loan_id || !conversation_id || !decision) {
    return Response.json({ error: "Required fields: handoff_id, loan_id, conversation_id, decision" }, { status: 400 });
  }

  try {
    // 1. Resolve the loan in the database
    await dbPatch(`/loans/${loan_id}/resolve`, {
      decision,
      resolved_by: `human:${resolved_by}`,
      reason,
    });

    // 2. Resolve the handoff in the database
    await dbPatch(`/handoffs/${handoff_id}/resolve`, {});

    // 3. Notify the customer via SSE
    publish(conversation_id, {
      type: "loan_resolved",
      payload: {
        conversation_id,
        loan_id,
        decision,
        reason,
      },
    });

    // 4. Notify the backoffice (global channel)
    publish("*", {
      type: "loan_resolved",
      payload: { conversation_id, loan_id, decision, reason },
    });

    return Response.json({ success: true, decision });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

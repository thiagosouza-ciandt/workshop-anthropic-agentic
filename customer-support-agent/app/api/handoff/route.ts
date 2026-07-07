// ============================================================
// POST /api/handoff   — human sends a message to the customer
// PATCH /api/handoff  — human resolves the loan (approve/reject)
// ============================================================

import { publish } from "@/app/lib/sse-store";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

// Simple shared-secret guard for backoffice-only endpoints.
// In production replace with proper session auth + RBAC.
// Set BACKOFFICE_SECRET in .env.local; if not set, falls back to "workshop" (dev only).
const BACKOFFICE_SECRET = process.env.BACKOFFICE_SECRET ?? "workshop";

function requireBackofficeAuth(req: Request): Response | null {
  const token = req.headers.get("x-backoffice-secret");
  if (token !== BACKOFFICE_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

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
// Two sub-actions via `action` field:
//   "message"        — human sends a message to the customer (requires auth)
//   "customer_reply" — customer replies during handoff, forwarded to backoffice (no auth)
//   "return_to_agent"— human ends the handoff and returns to AI agent (requires auth)
export async function POST(req: Request) {
  const body = await req.json();
  const action = body.action ?? "message";

  if (action === "customer_reply") {
    // Customer-side: forward message to backoffice SSE channel
    const { conversation_id, message } = body;
    if (!conversation_id || !message)
      return Response.json({ error: "conversation_id and message required" }, { status: 400 });

    publish("*", {
      type: "customer_message",
      payload: { conversation_id, message },
    });
    return Response.json({ success: true });
  }

  // All other actions require backoffice auth
  const authError = requireBackofficeAuth(req);
  if (authError) return authError;

  if (action === "return_to_agent") {
    const { conversation_id, handoff_id } = body;
    if (!conversation_id || !handoff_id)
      return Response.json({ error: "conversation_id and handoff_id required" }, { status: 400 });

    // Resolve the handoff in the DB
    await dbPatch(`/handoffs/${handoff_id}/resolve`, {});

    // Notify the customer chat to switch back to AI mode
    publish(conversation_id, {
      type: "agent_returned",
      payload: { conversation_id },
    });

    // Notify backoffice
    publish("*", {
      type: "agent_returned",
      payload: { conversation_id },
    });

    return Response.json({ success: true });
  }

  // Default: human sends a message to the customer
  const { conversation_id, message } = body;
  if (!conversation_id || !message)
    return Response.json({ error: "conversation_id and message are required" }, { status: 400 });

  publish(conversation_id, {
    type: "human_message",
    payload: { conversation_id, message, from: "Human agent" },
  });

  return Response.json({ success: true });
}

// PATCH /api/handoff
// Human approves or rejects and resolves the handoff
// Body: { handoff_id, loan_id, conversation_id, decision, reason?, amount? }
// Note: resolved_by is set server-side — never trusted from the client
export async function PATCH(req: Request) {
  const authError = requireBackofficeAuth(req);
  if (authError) return authError;

  const {
    handoff_id,
    loan_id,
    conversation_id,
    decision,
    reason,
    amount,
  } = await req.json();
  const resolved_by = "human"; // derived server-side, not from request body

  if (!handoff_id || !conversation_id || !decision) {
    return Response.json({ error: "Required fields: handoff_id, conversation_id, decision" }, { status: 400 });
  }

  try {
    // 1. Resolve the loan in the database (only if loan_id present)
    if (loan_id) {
      await dbPatch(`/loans/${loan_id}/resolve`, {
        decision,
        resolved_by: `human:${resolved_by}`,
        reason,
      });
    }

    // 2. Resolve the handoff in the database
    await dbPatch(`/handoffs/${handoff_id}/resolve`, {});

    const payload = { conversation_id, loan_id, decision, reason, amount };

    // 3. Notify the customer via SSE
    publish(conversation_id, { type: "loan_resolved", payload });

    // 4. Notify the backoffice (global channel)
    publish("*", { type: "loan_resolved", payload });

    return Response.json({ success: true, decision });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

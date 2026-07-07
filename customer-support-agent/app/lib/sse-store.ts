// ============================================================
// SSE Store — in-memory pub/sub between API routes and SSE clients
// ============================================================
// How it works:
//   • The chat route.ts publishes events with publish()
//   • GET /api/stream listens with subscribe()
//   • The backoffice and the customer chat open an EventSource pointing to /api/stream
//
// Why in-memory?
//   Sufficient for the workshop — a single Node.js process.
//   In production it would be Redis Pub/Sub or similar.
// ============================================================

export type SSEEvent =
  | { type: "handoff_created";   payload: HandoffPayload }
  | { type: "handoff_claimed";   payload: { handoff_id: string; claimed_by: string } }
  | { type: "human_message";     payload: { conversation_id: string; message: string; from: string } }
  | { type: "customer_message";  payload: { conversation_id: string; message: string } }
  | { type: "loan_resolved";     payload: { conversation_id: string; loan_id: string; decision: "approved" | "rejected"; reason?: string; amount?: number } }
  | { type: "agent_returned";    payload: { conversation_id: string } };

export type HandoffPayload = {
  handoff_id: string;
  conversation_id: string;
  customer_id: string;
  customer_name: string;
  loan_id: string;
  amount: number;
  context: {
    messages: Array<{ role: string; content: string }>;
    agent_reasoning: string;
    customer_summary: string;
  };
};

// Map of conversation_id → set of WritableStreamDefaultWriter (one per open tab)
type Subscriber = (event: SSEEvent) => void;

// Use globalThis to survive Next.js hot reloads in dev mode.
// In production (single long-lived process) this behaves identically to a module-level Map.
const g = globalThis as any;
if (!g.__sse_subscribers) g.__sse_subscribers = new Map<string, Set<Subscriber>>();
const subscribers: Map<string, Set<Subscriber>> = g.__sse_subscribers;

// ── Conversation → CustomerId store ──────────────────────────────────────────
// Server-side map so we never trust the client-supplied customerId.
// Keyed by conversationId (UUID), value is the id returned by identify_customer tool.
if (!g.__conv_customer) g.__conv_customer = new Map<string, string>();
const convCustomer: Map<string, string> = g.__conv_customer;

export function setConvCustomer(conversationId: string, customerId: string) {
  convCustomer.set(conversationId, customerId);
}
export function getConvCustomer(conversationId: string): string | null {
  return convCustomer.get(conversationId) ?? null;
}

// Subscribe a listener to a conversation_id (or "*" for the backoffice)
export function subscribe(channel: string, fn: Subscriber): () => void {
  if (!subscribers.has(channel)) subscribers.set(channel, new Set());
  subscribers.get(channel)!.add(fn);
  return () => subscribers.get(channel)?.delete(fn);
}

// Publish an event to a specific channel AND to the global backoffice channel
export function publish(channel: string, event: SSEEvent) {
  subscribers.get(channel)?.forEach((fn) => fn(event));
  if (channel !== "*") {
    subscribers.get("*")?.forEach((fn) => fn(event));
  }
}

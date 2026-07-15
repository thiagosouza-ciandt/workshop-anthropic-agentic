// In-memory pub/sub store for SSE events between API routes and browser clients.

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

type Subscriber = (event: SSEEvent) => void;

// globalThis survives Next.js hot reloads in dev; identical to a module-level Map in production.
const g = globalThis as any;
if (!g.__sse_subscribers) g.__sse_subscribers = new Map<string, Set<Subscriber>>();
const subscribers: Map<string, Set<Subscriber>> = g.__sse_subscribers;

// Server-side conversationId → customerId map — never trust the client-supplied ID.
if (!g.__conv_customer) g.__conv_customer = new Map<string, string>();
const convCustomer: Map<string, string> = g.__conv_customer;

export function setConvCustomer(conversationId: string, customerId: string) {
  convCustomer.set(conversationId, customerId);
}
export function getConvCustomer(conversationId: string): string | null {
  return convCustomer.get(conversationId) ?? null;
}

// Subscribe to a channel — returns an unsubscribe function
export function subscribe(channel: string, fn: Subscriber): () => void {
  if (!subscribers.has(channel)) subscribers.set(channel, new Set());
  subscribers.get(channel)!.add(fn);
  return () => subscribers.get(channel)?.delete(fn);
}

// Publish to a channel and always mirror to "*" (backoffice)
export function publish(channel: string, event: SSEEvent) {
  subscribers.get(channel)?.forEach((fn) => fn(event));
  if (channel !== "*") {
    subscribers.get("*")?.forEach((fn) => fn(event));
  }
}

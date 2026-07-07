# Step 4 — Backoffice + SSE + Human-in-the-loop (40 min)

## Concept

Two browsers open at the same time:
- `localhost:3000` — customer chat
- `localhost:3000/backoffice` — human agent sees handoffs in real time

Flow for loan > $500:
```
Customer requests $1000 loan
  → Coordinator → PaymentsAgent → DB registers loan (pending)
  → route.ts detects needs_human_approval: true
  → creates handoff in DB
  → publishes SSE event on channel "*"
  → Backoffice receives it instantly (no refresh)
  → Human reads context, types a message → appears in customer chat
  → Human approves/rejects → customer receives decision via SSE
```

---

## Block A — Create `app/lib/sse-store.ts`

New file — the in-memory pub/sub between API routes and SSE clients:

```ts
export type SSEEvent =
  | { type: "handoff_created"; payload: HandoffPayload }
  | { type: "human_message";   payload: { conversation_id: string; message: string; from: string } }
  | { type: "loan_resolved";   payload: { conversation_id: string; loan_id: string; decision: "approved" | "rejected"; reason?: string } };

export type HandoffPayload = {
  handoff_id: string;
  conversation_id: string;
  customer_id: string;
  customer_name: string;
  loan_id: string;
  context: { messages: any[]; agent_reasoning: string; customer_summary: string };
};

type Subscriber = (event: SSEEvent) => void;
const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(channel: string, fn: Subscriber): () => void {
  if (!subscribers.has(channel)) subscribers.set(channel, new Set());
  subscribers.get(channel)!.add(fn);
  return () => subscribers.get(channel)?.delete(fn);
}

export function publish(channel: string, event: SSEEvent) {
  subscribers.get(channel)?.forEach((fn) => fn(event));
  if (channel !== "*") subscribers.get("*")?.forEach((fn) => fn(event));
}
```

---

## Block B — Create `app/api/stream/route.ts`

The SSE endpoint — browser opens it and keeps the connection alive:

```ts
import { subscribe, SSEEvent } from "@/app/lib/sse-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const channel = new URL(req.url).searchParams.get("channel") ?? "*";
  const enc = (s: string) => new TextEncoder().encode(s);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc(`: connected to ${channel}\n\n`));
      const unsub = subscribe(channel, (event: SSEEvent) => {
        try {
          controller.enqueue(enc(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
        } catch {}
      });
      const hb = setInterval(() => { try { controller.enqueue(enc(`: heartbeat\n\n`)); } catch { clearInterval(hb); } }, 25_000);
      req.signal.addEventListener("abort", () => { unsub(); clearInterval(hb); controller.close(); });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

---

## Block C — Create `app/api/handoff/route.ts`

Two endpoints: human sends a message, or resolves a loan:

```ts
import { publish } from "@/app/lib/sse-store";
const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

const dbPatch = async (path: string, body: object) => {
  const res = await fetch(`${CORPDB_URL}${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`CorpDB ${res.status}: ${path}`);
  return res.json();
};

// Human sends a message to the customer
export async function POST(req: Request) {
  const { conversation_id, message, from = "Human agent" } = await req.json();
  publish(conversation_id, { type: "human_message", payload: { conversation_id, message, from } });
  return Response.json({ success: true });
}

// Human approves or rejects the loan
export async function PATCH(req: Request) {
  const { handoff_id, loan_id, conversation_id, decision, resolved_by = "human", reason } = await req.json();
  await dbPatch(`/loans/${loan_id}/resolve`, { decision, resolved_by: `human:${resolved_by}`, reason });
  await dbPatch(`/handoffs/${handoff_id}/resolve`, {});
  publish(conversation_id, { type: "loan_resolved", payload: { conversation_id, loan_id, decision, reason } });
  publish("*",             { type: "loan_resolved", payload: { conversation_id, loan_id, decision, reason } });
  return Response.json({ success: true, decision });
}
```

---

## Block D — Update `route.ts`

**Add** to imports at the top:

```ts
import { publish } from "@/app/lib/sse-store";
```

**Add** `conversationId` to the destructured request body:

```ts
const { messages, model, conversationId = crypto.randomUUID() } = await req.json();
```

**Add** right after the `const result = await runCoordinator(...)` call, still inside the `try` block:

```ts
    if (result.orchestration?.needs_human_approval && result.orchestration.loan_id) {
      const corpdbUrl = process.env.CORPDB_URL ?? "http://localhost:3001";
      const customer = await fetch(`${corpdbUrl}/customers/${messages[0]?.customerId}`).then(r => r.ok ? r.json() : null).catch(() => null);

      const handoff = await fetch(`${corpdbUrl}/handoffs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          customer_id: messages[0]?.customerId ?? "unknown",
          loan_id: result.orchestration.loan_id,
          context: {
            messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
            agent_reasoning: result.thinking,
            customer_summary: customer ? `${customer.name} | Credit limit: $${customer.credit_limit_usd}` : "Unknown customer",
          },
        }),
      }).then(r => r.json());

      publish("*", {
        type: "handoff_created",
        payload: {
          handoff_id: handoff.id,
          conversation_id: conversationId,
          customer_id: customer?.id ?? "",
          customer_name: customer?.name ?? "Unknown",
          loan_id: result.orchestration.loan_id,
          context: handoff.context ?? {},
        },
      });
    }
```

**Update** the return statement to include `conversation_id`:

```ts
    return Response.json({ id: crypto.randomUUID(), conversation_id: conversationId, ...result });
```

---

## Block E — Update `ChatArea.tsx`

**Add** inside the component (after the `useState` declarations):

```ts
  const [conversationId] = useState(() => crypto.randomUUID());
```

**Add** `conversationId` to the fetch body inside `handleSubmit`:

```ts
  body: JSON.stringify({
    messages: [...messages, userMessage],
    model: selectedModel,
    conversationId,          // ← add this line
  }),
```

**Add** a new `useEffect` for SSE (paste after the existing `useEffect` blocks):

```ts
  useEffect(() => {
    const es = new EventSource(`/api/stream?channel=${conversationId}`);

    es.addEventListener("human_message", (e) => {
      const { message, from } = JSON.parse(e.data);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: JSON.stringify({
          response: `**[${from}]** ${message}`,
          thinking: "Message sent directly by the human agent.",
          user_mood: "neutral",
          suggested_questions: [],
          redirect_to_agent: { should_redirect: false },
          debug: { context_used: false },
        }),
      }]);
    });

    es.addEventListener("loan_resolved", (e) => {
      const { decision, reason } = JSON.parse(e.data);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: JSON.stringify({
          response: `Your loan request has been **${decision}**.${reason ? ` Reason: ${reason}` : ""}`,
          thinking: `Human decision: ${decision}`,
          user_mood: decision === "approved" ? "positive" : "negative",
          suggested_questions: [],
          redirect_to_agent: { should_redirect: false },
          debug: { context_used: false },
        }),
      }]);
    });

    es.onerror = () => console.warn("SSE: reconnecting...");
    return () => es.close();
  }, [conversationId]);
```

---

## Block F — Create `app/backoffice/page.tsx`

Copy the full file from:
```
workshop/step4-backoffice/app/backoffice/page.tsx
```

This is the only file that is pasted whole — it's pure UI with no agent logic.

---

## Test

1. Open `localhost:3000` (customer) and `localhost:3000/backoffice` (human) side by side
2. In the chat: `"I'd like a loan of $1000. Alice Johnson, +1-555-0101"`
3. Watch the backoffice receive the handoff **instantly**
4. In the backoffice: read the agent reasoning, send a message to the customer
5. The message appears in the customer chat as `[Human agent]`
6. Click Approve or Reject — the customer receives the decision in real time

## Discussion points

- **SSE vs WebSocket?** SSE is server→client only, natively supported by browsers (`EventSource`), and simpler for this pattern. No need for a full-duplex channel.
- **Why in-memory pub/sub?** Works for a single Node.js process (dev). In production: Redis Pub/Sub — same `subscribe`/`publish` interface, different implementation.
- **What if the customer refreshes?** The handoff stays in the DB. When they reconnect with the same `conversationId`, they will receive the `loan_resolved` event as soon as the human decides.

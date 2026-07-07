// ============================================================
// GET /api/stream?channel=<conversation_id|*>
// ============================================================
// SSE endpoint. The client (browser) opens an EventSource here and
// receives events in real time without polling.
//
// The backoffice uses channel=* to see all events.
// The customer chat uses channel=<conversation_id> to receive
// only the human agent messages directed to that conversation.
// ============================================================

import { subscribe, SSEEvent } from "@/workshop/step4-backoffice/lib/sse-store";
// In production: import { subscribe, SSEEvent } from "@/app/lib/sse-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel") ?? "*";

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial comment to keep the connection alive
      controller.enqueue(encoder(`: connected to channel ${channel}\n\n`));

      const unsubscribe = subscribe(channel, (event: SSEEvent) => {
        try {
          controller.enqueue(
            encoder(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`)
          );
        } catch {
          // Connection closed — ignore
        }
      });

      // Heartbeat every 25s to prevent browser/proxy timeout
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Cleanup when the client closes the connection
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

const encoder = (text: string) => new TextEncoder().encode(text);

// GET /api/stream?channel=<conversation_id|*>
// SSE endpoint — backoffice subscribes to "*", customer chat to its own conversationId.

import { subscribe, SSEEvent } from "@/app/lib/sse-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel") ?? "*";

  const stream = new ReadableStream({
    start(controller) {
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

      // Heartbeat prevents browser/proxy from closing an idle connection
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Unsubscribe and stop heartbeat when the client disconnects
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

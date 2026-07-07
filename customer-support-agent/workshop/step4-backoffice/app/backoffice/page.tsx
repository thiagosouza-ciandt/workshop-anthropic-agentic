"use client";

// ============================================================
// Backoffice — human agent view
// ============================================================
// What this page shows:
//   • List of pending handoffs (loans > $500)
//   • Full context: conversation, agent reasoning, customer data
//   • Interface to approve/reject and send a message to the customer
//   • Everything in real time via SSE
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Message = { role: string; content: string };

type Handoff = {
  handoff_id: string;
  conversation_id: string;
  customer_id: string;
  customer_name: string;
  loan_id: string;
  amount: number;
  context: {
    messages: Message[];
    agent_reasoning: string;
    customer_summary: string;
  };
  status: "waiting" | "claimed" | "resolved";
  resolved?: boolean;
  decision?: "approved" | "rejected";
};

// ── Hook: global backoffice SSE ───────────────────────────────────────────────
function useBackofficeSSE(onEvent: (type: string, payload: any) => void) {
  useEffect(() => {
    const es = new EventSource("/api/stream?channel=*");

    es.addEventListener("handoff_created", (e) => onEvent("handoff_created", JSON.parse(e.data)));
    es.addEventListener("loan_resolved", (e) => onEvent("loan_resolved", JSON.parse(e.data)));
    es.addEventListener("handoff_claimed", (e) => onEvent("handoff_claimed", JSON.parse(e.data)));

    es.onerror = () => console.warn("SSE backoffice: reconnecting...");

    return () => es.close();
  }, [onEvent]);
}

// ── Component: handoff panel ──────────────────────────────────────────────────
function HandoffPanel({
  handoff,
  onResolve,
}: {
  handoff: Handoff;
  onResolve: (handoffId: string, loanId: string, convId: string, decision: "approved" | "rejected", reason: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const sendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    await fetch("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: handoff.conversation_id,
        message,
        from: "Human agent",
      }),
    });
    setMessage("");
    setSending(false);
  };

  const resolve = (decision: "approved" | "rejected") => {
    onResolve(handoff.handoff_id, handoff.loan_id, handoff.conversation_id, decision, reason);
  };

  const statusColor = {
    waiting: "bg-yellow-100 text-yellow-800",
    claimed: "bg-blue-100 text-blue-800",
    resolved: "bg-green-100 text-green-800",
  }[handoff.status];

  return (
    <Card className="mb-4 border-l-4 border-l-orange-400">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {handoff.customer_name}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {handoff.customer_id}
            </span>
          </CardTitle>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor}`}>
            {handoff.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{handoff.context.customer_summary}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Agent reasoning */}
        <div className="bg-muted rounded-md p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Agent reasoning</p>
          <p className="text-sm">{handoff.context.agent_reasoning}</p>
        </div>

        {/* Conversation history */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Conversation</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {handoff.context.messages.map((msg, i) => (
              <div
                key={i}
                className={`text-sm p-2 rounded-md ${
                  msg.role === "user"
                    ? "bg-primary/10 text-right"
                    : "bg-muted"
                }`}
              >
                <span className="text-xs text-muted-foreground block mb-1">
                  {msg.role === "user" ? "Customer" : "Agent"}
                </span>
                {/* Assistant messages come as JSON — extract only the response */}
                {msg.role === "assistant"
                  ? (() => {
                      try { return JSON.parse(msg.content).response; }
                      catch { return msg.content; }
                    })()
                  : msg.content}
              </div>
            ))}
          </div>
        </div>

        {!handoff.resolved && (
          <>
            {/* Send message to customer */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Send message to customer
              </p>
              <div className="flex gap-2">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message to the customer..."
                  rows={2}
                  className="text-sm"
                />
                <Button size="sm" onClick={sendMessage} disabled={sending || !message.trim()}>
                  Send
                </Button>
              </div>
            </div>

            {/* Loan decision */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Loan decision
              </p>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                rows={2}
                className="text-sm mb-2"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => resolve("approved")}
                >
                  Approve loan
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => resolve("rejected")}
                >
                  Reject
                </Button>
              </div>
            </div>
          </>
        )}

        {handoff.resolved && (
          <Badge
            className={
              handoff.decision === "approved"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }
          >
            {handoff.decision === "approved" ? "Approved" : "Rejected"}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BackofficePage() {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) =>
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));

  const handleSSEEvent = (type: string, payload: any) => {
    addLog(`${type}: ${JSON.stringify(payload).slice(0, 80)}...`);

    if (type === "handoff_created") {
      setHandoffs((prev) => [
        { ...payload, status: "waiting", resolved: false },
        ...prev,
      ]);
    }

    if (type === "loan_resolved") {
      setHandoffs((prev) =>
        prev.map((h) =>
          h.conversation_id === payload.conversation_id
            ? { ...h, status: "resolved", resolved: true, decision: payload.decision }
            : h
        )
      );
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useBackofficeSSE(handleSSEEvent);

  const resolveHandoff = async (
    handoffId: string,
    loanId: string,
    conversationId: string,
    decision: "approved" | "rejected",
    reason: string,
  ) => {
    await fetch("/api/handoff", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handoff_id: handoffId,
        loan_id: loanId,
        conversation_id: conversationId,
        decision,
        resolved_by: "human",
        reason,
      }),
    });
  };

  const waiting = handoffs.filter((h) => !h.resolved);
  const resolved = handoffs.filter((h) => h.resolved);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Backoffice — CorpBank</h1>
            <p className="text-muted-foreground text-sm">Real-time approvals and handoffs</p>
          </div>
          <div className="flex gap-3 text-sm">
            <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full font-medium">
              {waiting.length} pending
            </span>
            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">
              {resolved.length} resolved
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main column: handoffs */}
          <div className="lg:col-span-2">
            {waiting.length === 0 && resolved.length === 0 && (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <p>No handoffs yet.</p>
                  <p className="text-sm mt-1">
                    Request a loan above $500 in the customer chat to trigger one.
                  </p>
                </CardContent>
              </Card>
            )}

            {waiting.map((h) => (
              <HandoffPanel key={h.handoff_id} handoff={h} onResolve={resolveHandoff} />
            ))}

            {resolved.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 mt-4">Resolved</p>
                {resolved.map((h) => (
                  <HandoffPanel key={h.handoff_id} handoff={h} onResolve={resolveHandoff} />
                ))}
              </div>
            )}
          </div>

          {/* SSE event log */}
          <div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">SSE Event Log</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {log.length === 0 && (
                    <p className="text-xs text-muted-foreground">Waiting for events...</p>
                  )}
                  {log.map((entry, i) => (
                    <p key={i} className="text-xs font-mono text-muted-foreground break-all">
                      {entry}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

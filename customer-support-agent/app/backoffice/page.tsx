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

// Extract requested amount from agent reasoning (e.g. "$600", "$1,000")
function extractAmount(text: string | undefined): string {
  if (!text) return "";
  const m = text.match(/\$[\d,]+/);
  return m ? m[0].replace(/[$,]/g, "") : "";
}

// ── Hook: global backoffice SSE ───────────────────────────────────────────────
function useBackofficeSSE(onEvent: (type: string, payload: any) => void) {
  useEffect(() => {
    const es = new EventSource("/api/stream?channel=*");

    es.addEventListener("handoff_created", (e) => onEvent("handoff_created", JSON.parse(e.data)));
    es.addEventListener("loan_resolved",   (e) => onEvent("loan_resolved",   JSON.parse(e.data)));
    es.addEventListener("handoff_claimed", (e) => onEvent("handoff_claimed", JSON.parse(e.data)));
    es.addEventListener("agent_returned",  (e) => onEvent("agent_returned",  JSON.parse(e.data)));

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
  onResolve: (handoffId: string, loanId: string, convId: string, decision: "approved" | "rejected", reason: string, amount: string) => void;
}) {
  const isLoan = !!handoff.loan_id;
  const prefilledAmount = extractAmount(handoff.context?.agent_reasoning);

  const [chatMessages, setChatMessages] = useState<{ from: string; text: string }[]>([]);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(prefilledAmount);
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // SSE: receive customer replies directed to this conversation
  useEffect(() => {
    if (handoff.resolved) return;
    const es = new EventSource(`/api/stream?channel=*`);

    es.addEventListener("customer_message", (e) => {
      const { conversation_id, message: msg } = JSON.parse(e.data);
      if (conversation_id !== handoff.conversation_id) return;
      if (msg === "__return_to_agent__") return; // internal signal
      setChatMessages((prev) => [...prev, { from: "Customer", text: msg }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });

    return () => es.close();
  }, [handoff.conversation_id, handoff.resolved]);

  const sendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    const text = message;
    setMessage("");
    setChatMessages((prev) => [...prev, { from: "You", text }]);
    await fetch("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-backoffice-secret": "workshop" },
      body: JSON.stringify({ conversation_id: handoff.conversation_id, message: text }),
    });
    setSending(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const resolve = (decision: "approved" | "rejected") => {
    onResolve(handoff.handoff_id, handoff.loan_id, handoff.conversation_id, decision, reason, amount);
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
            <span className="ml-2 text-sm font-normal text-muted-foreground">{handoff.customer_id}</span>
          </CardTitle>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor}`}>{handoff.status}</span>
        </div>
        <p className="text-sm text-muted-foreground">{handoff.context?.customer_summary}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Agent reasoning */}
        <div className="bg-muted rounded-md p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Agent reasoning</p>
          <p className="text-sm">{handoff.context?.agent_reasoning}</p>
        </div>

        {/* Conversation history */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Conversation history</p>
          <div className="space-y-1 max-h-36 overflow-y-auto bg-muted/30 rounded-md p-2">
            {(handoff.context.messages ?? []).map((msg, i) => (
              <div key={i} className={`text-xs p-1.5 rounded ${msg.role === "user" ? "text-right" : ""}`}>
                <span className="text-muted-foreground font-medium">
                  {msg.role === "user" ? "Customer: " : "Agent: "}
                </span>
                {msg.role === "assistant"
                  ? (() => { try { return JSON.parse(msg.content).response; } catch { return msg.content; } })()
                  : msg.content}
              </div>
            ))}
          </div>
        </div>

        {/* Live chat with customer */}
        {!handoff.resolved && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Live chat</p>
            <div className="border rounded-md bg-background">
              <div className="space-y-1 max-h-36 overflow-y-auto p-2 min-h-[40px]">
                {chatMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No messages yet — type below to talk to the customer.</p>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`text-xs p-1.5 rounded ${m.from === "You" ? "text-right bg-primary/10" : "bg-muted"}`}>
                    <span className="font-medium text-muted-foreground">{m.from === "You" ? "You: " : `${m.from}: `}</span>
                    {m.text}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="border-t flex gap-2 p-2">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Message customer... (Enter to send)"
                  rows={1}
                  className="text-sm resize-none"
                />
                <Button size="sm" onClick={sendMessage} disabled={sending || !message.trim()}>Send</Button>
              </div>
            </div>
          </div>
        )}

        {/* Decision */}
        {!handoff.resolved && (
          <div className="border rounded-md p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              {isLoan ? "Loan decision" : "Decision"}
            </p>
            <div className="flex gap-2 items-center">
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                {isLoan ? "Approved amount ($)" : "Amount ($)"}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-7 text-xs border rounded px-2 w-28 bg-background"
              />
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="h-7 text-xs border rounded px-2 w-full bg-background"
            />
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => resolve("approved")}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => resolve("rejected")}>
                Reject
              </Button>
              <Button size="sm" variant="outline" onClick={async () => {
                await fetch("/api/handoff", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-backoffice-secret": "workshop" },
                  body: JSON.stringify({ action: "return_to_agent", handoff_id: handoff.handoff_id, conversation_id: handoff.conversation_id }),
                });
              }}>
                Return to AI agent
              </Button>
            </div>
          </div>
        )}

        {handoff.resolved && (
          <Badge className={handoff.decision === "approved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
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
  const [filter, setFilter] = useState<"waiting" | "resolved" | "all">("waiting");
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) =>
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));

  // Load existing handoffs from DB — SSE only delivers new ones
  const loadHandoffs = async (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    const res = await fetch(`/api/db/handoffs${qs}`);
    if (!res.ok) return;
    const rows: any[] = await res.json();
    setHandoffs(rows.map((h) => ({
      handoff_id: h.id,
      conversation_id: h.conversation_id,
      customer_id: h.customer_id,
      customer_name: h.customer_name,
      loan_id: h.loan_id ?? "",
      amount: 0,
      context: (() => {
        try {
          const c = typeof h.context === "string" ? JSON.parse(h.context) : h.context;
          return c ?? { messages: [], agent_reasoning: "", customer_summary: "" };
        } catch { return { messages: [], agent_reasoning: "", customer_summary: "" }; }
      })(),
      status: h.status,
      resolved: h.status === "resolved",
      decision: undefined,
    })));
  };

  useEffect(() => { loadHandoffs(filter === "all" ? undefined : filter); }, [filter]);

  const handleSSEEvent = (type: string, payload: any) => {
    addLog(`${type}: ${JSON.stringify(payload).slice(0, 80)}...`);

    if (type === "handoff_created") {
      // Only add to list if current filter shows pending/all
      if (filter === "waiting" || filter === "all") {
        setHandoffs((prev) => {
          if (prev.some((h) => h.handoff_id === payload.handoff_id)) return prev;
          return [{ ...payload, status: "waiting", resolved: false }, ...prev];
        });
      }
    }

    if (type === "loan_resolved" || type === "agent_returned") {
      // Reload from DB to respect current filter
      loadHandoffs(filter === "all" ? undefined : filter);
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
    amount: string,
  ) => {
    await fetch("/api/handoff", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-backoffice-secret": "workshop" },
      body: JSON.stringify({
        handoff_id: handoffId,
        loan_id: loanId,
        conversation_id: conversationId,
        decision,
        reason,
        amount: amount ? Number(amount) : undefined,
      }),
    });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Backoffice — CorpBank</h1>
            <p className="text-muted-foreground text-sm">Real-time approvals and handoffs</p>
          </div>
          <button
            onClick={() => loadHandoffs(filter === "all" ? undefined : filter)}
            className="text-xs text-muted-foreground border rounded px-3 py-1 hover:bg-muted"
          >
            Refresh
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 border-b">
          {(["waiting", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
                filter === f
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "waiting" ? "Pending" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main column: handoffs */}
          <div className="lg:col-span-2">
            {handoffs.length === 0 && (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  <p>No {filter === "all" ? "" : filter} handoffs.</p>
                  {filter === "waiting" && (
                    <p className="text-sm mt-1">Request a loan above $500 in the customer chat to trigger one.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {handoffs.map((h) => (
              <HandoffPanel key={h.handoff_id} handoff={h} onResolve={resolveHandoff} />
            ))}
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

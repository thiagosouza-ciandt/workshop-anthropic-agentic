// ============================================================
// WORKSHOP — Step 4: ChatArea.tsx patch
// ============================================================
// Add these snippets to the existing ChatArea.tsx.
// It is not necessary to rewrite the entire component.
// ============================================================

// ── STEP 1: New state (inside the ChatArea component) ────────────────────────
//
// const [conversationId] = useState(() => crypto.randomUUID());
//
// Generates a unique ID per chat session. Used to:
//   • Send in the body of each request to /api/chat
//   • Filter SSE events for this conversation only

// ── STEP 2: Send conversationId in the body (inside handleSubmit) ─────────────
//
// Locate the fetch to /api/chat and add conversationId to the body:
//
// body: JSON.stringify({
//   messages: [...messages, userMessage],
//   model: selectedModel,
//   customerId: "cust_001",   // in production comes from login
//   conversationId,           // <- add this line
// }),

// ── STEP 3: SSE Hook (inside the ChatArea component) ─────────────────────────
//
// useEffect(() => {
//   const es = new EventSource(`/api/stream?channel=${conversationId}`);
//
//   // Message sent by the human agent in the backoffice
//   es.addEventListener("human_message", (e) => {
//     const payload = JSON.parse(e.data);
//     const humanMsg = {
//       id: crypto.randomUUID(),
//       role: "assistant",
//       content: JSON.stringify({
//         response: `**[Human agent]** ${payload.message}`,
//         thinking: "Message sent directly by the human agent.",
//         user_mood: "neutral",
//         suggested_questions: [],
//         redirect_to_agent: { should_redirect: false },
//         debug: { context_used: false },
//       }),
//     };
//     setMessages((prev) => [...prev, humanMsg]);
//   });
//
//   // Loan decision arrived
//   es.addEventListener("loan_resolved", (e) => {
//     const payload = JSON.parse(e.data);
//     const decision = payload.decision === "approved" ? "approved" : "rejected";
//     const resolvedMsg = {
//       id: crypto.randomUUID(),
//       role: "assistant",
//       content: JSON.stringify({
//         response: `Your loan request has been **${decision}**.${
//           payload.reason ? ` Reason: ${payload.reason}` : ""
//         }`,
//         thinking: `Human decision: ${decision}`,
//         user_mood: payload.decision === "approved" ? "positive" : "negative",
//         suggested_questions: [],
//         redirect_to_agent: { should_redirect: false },
//         debug: { context_used: false },
//       }),
//     };
//     setMessages((prev) => [...prev, resolvedMsg]);
//   });
//
//   es.onerror = () => console.warn("SSE chat: reconnecting...");
//   return () => es.close();
// }, [conversationId]);

export {};

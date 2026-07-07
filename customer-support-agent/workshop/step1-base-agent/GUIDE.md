# Step 1 — Base Agent (20 min)

## What we will build

A banking support agent that:
- Receives customer messages via chat
- Responds using Claude via Amazon Bedrock
- Always returns a structured JSON (validated with Zod)

No database, no tools — just the basic conversation loop.

---

## How to apply

Copy the content of `route.ts` and paste it into:

```
app/api/chat/route.ts
```

Replace the entire existing file.

---

## Run and test

```bash
npm run dev
```

Open `http://localhost:3000` and send messages like:

- "I want to check my balance"
- "I have an overdue bill"
- "I want to request a loan"
- "I want to speak with a human"

---

## Concepts of this step

### 1. Bedrock Client
```ts
const anthropic = new AnthropicBedrock({ awsRegion: "us-east-1" });
```
Authenticates via **IAM Role** — no keys in the code.
The SDK automatically reads credentials from the AWS environment.

### 2. System prompt
Defines the agent's **identity and scope**.
Everything here applies to the entire conversation — it is the agent's "code of conduct".

### 3. Structured output via prompt
We ask Claude to always respond in JSON with specific fields.
Zod validates — if Claude "invents" a field or forgets one, the route rejects it.

### 4. Message history
```ts
messages.map(msg => ({ role: msg.role, content: msg.content }))
```
The frontend already sends the full history with each request.
Claude uses this to maintain conversation context.

---

## Discussion points

- **Why JSON instead of plain text?**
  Because the frontend needs to render `response`, display `suggested_questions`,
  and detect `redirect_to_agent`. Plain text does not allow this.

- **Why Zod?**
  LLMs are non-deterministic. Zod is the contract between the agent and the frontend.
  If Claude changes the format, the error surfaces here — not silently in the UI.

- **What is `thinking`?**
  The agent's internal reasoning. The customer does not see it — but the back office will
  in Step 4. It is the first step toward agent observability.

---

## What is missing (coming in Step 2)

The agent responds, but does not know the customer's real balance.
When someone asks "what is my balance?", it guesses or says it has no access.

In the next step: **tool calling** — the agent will query the real database.

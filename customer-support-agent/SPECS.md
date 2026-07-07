# Customer Support Agent — Specs

## Overview

Chat-based research agent built with Next.js + TypeScript, integrated with **Amazon Bedrock** for response generation via Claude and for context retrieval via RAG (Retrieval-Augmented Generation).

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + React + TypeScript |
| UI Components | shadcn/ui + Tailwind CSS |
| LLM | Anthropic Claude via **Amazon Bedrock** (`@anthropic-ai/bedrock-sdk`) |
| RAG | Amazon Bedrock Knowledge Bases (`@aws-sdk/client-bedrock-agent-runtime`) |
| Validation | Zod |

---

## Authentication / Credentials

- Uses **IAM Role** (no explicit keys in the code).
- The region is configured via the `AWS_REGION` environment variable (default: `us-east-1`).
- Requires `AmazonBedrockFullAccess` permission on the role/instance.

### Environment Variables

```
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=          # not used in the Bedrock version
BAWS_ACCESS_KEY_ID=         # not used in the Bedrock version
BAWS_SECRET_ACCESS_KEY=     # not used in the Bedrock version
```

> The `BAWS_*` variables were removed from the code. Authentication is now delegated to the AWS SDK (IAM Role or default environment credentials).

---

## Available Models (via Bedrock)

| Model ID (Bedrock) | Display Name | Default |
|---|---|---|
| `us.anthropic.claude-opus-4-8` | Claude Opus 4.8 | Yes |
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Claude Haiku 4.5 | No |

---

## API — `POST /api/chat`

### Request Body

```json
{
  "messages": [{ "role": "user", "content": "string" }],
  "model": "us.anthropic.claude-opus-4-8",
  "knowledgeBaseId": "string (optional)",
  "knowledgeBaseName": "string (optional)"
}
```

### Behavior

1. Retrieves context from the Knowledge Base via RAG (if `knowledgeBaseId` is provided).
2. Builds `systemPrompt` with support categories and RAG context.
3. Calls `anthropic.messages.create` via `AnthropicBedrock`.
4. Parses the JSON response with `sanitizeAndParseJSON`.
5. Returns the formatted response with RAG sources and debug metadata.

### Response Parsing (`sanitizeAndParseJSON`)

- Removes markdown code fences (` ```json ... ``` `).
- Extracts the first JSON object from the text.
- Escapes newlines inside strings.
- No longer injects `"{"` as a prefill (removed due to Bedrock incompatibility).

### Response Body

```json
{
  "message": "string",
  "thinking": "string (debug)",
  "ragSources": [{ "id": "string", "content": "string" }],
  "redirection": "string (optional)"
}
```

---

## Available Layouts

| Script | Description |
|---|---|
| `npm run dev` | Full app (both sidebars) |
| `npm run dev:left` | Left sidebar only |
| `npm run dev:right` | Right sidebar only |
| `npm run dev:chat` | Chat area only |

Controlled via environment variables:
- `NEXT_PUBLIC_INCLUDE_LEFT_SIDEBAR`
- `NEXT_PUBLIC_INCLUDE_RIGHT_SIDEBAR`

---

## Main Components

### `ChatArea.tsx`

- Main state: `messages`, `selectedModel`, `isLoading`, `input`.
- Sends messages to `/api/chat`.
- Displays RAG sources and debug information.
- Header shows "Research Agent" (no longer "Customer support").

### `app/lib/utils.ts`

- `retrieveContext(query, knowledgeBaseId)` — queries the Bedrock Knowledge Base via `RetrieveCommand`.
- `cn(...)` — Tailwind class merge.
- `BedrockAgentRuntimeClient` instantiated with `AWS_REGION` (no hardcoded credentials).

---

## Recent Changes (vs. original version)

| Item | Before | After |
|---|---|---|
| Claude SDK | `@anthropic-ai/sdk` | `@anthropic-ai/bedrock-sdk` |
| Authentication | `ANTHROPIC_API_KEY` | IAM Role via Bedrock |
| AWS Credentials | `BAWS_ACCESS_KEY_ID` / `BAWS_SECRET_ACCESS_KEY` | Removed (IAM Role) |
| Response prefill | Injected `"{"` into history | Removed |
| `temperature` | `0.3` | Removed (model default) |
| JSON Parser | Only escaped newlines | Fence stripping + object extraction |
| Models | Claude 3 Haiku / 3.5 Sonnet / 4.5 Haiku | Opus 4.8 / Haiku 4.5 (Bedrock IDs) |
| Agent label | "Customer support" | "Research Agent" |

---

## Deploy (AWS Amplify)

See README for full YAML. Key points:
- Use `AmazonBedrockFullAccess` on the Amplify service role.
- Set `AWS_REGION` in Amplify environment variables.
- The `BAWS_*` variables are no longer needed.

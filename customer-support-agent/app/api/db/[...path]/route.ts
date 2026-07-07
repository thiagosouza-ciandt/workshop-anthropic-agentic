// Transparent proxy to CorpDB — avoids CORS from the browser
import { NextRequest } from "next/server";

const CORPDB_URL = process.env.CORPDB_URL ?? "http://localhost:3001";

async function proxy(req: NextRequest, method: string) {
  const segments = req.nextUrl.pathname.replace("/api/db/", "");
  const search   = req.nextUrl.search ?? "";
  const url      = `${CORPDB_URL}/${segments}${search}`;

  const init: RequestInit = { method };
  if (method !== "GET" && method !== "DELETE") {
    init.headers = { "Content-Type": "application/json" };
    init.body    = await req.text();
  }

  const upstream = await fetch(url, init);
  const body     = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET    = (req: NextRequest) => proxy(req, "GET");
export const POST   = (req: NextRequest) => proxy(req, "POST");
export const PATCH  = (req: NextRequest) => proxy(req, "PATCH");
export const DELETE = (req: NextRequest) => proxy(req, "DELETE");

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const API = "/api/db";

// ── Types ─────────────────────────────────────────────────────────────────────

type Customer = {
  id: string; name: string; email: string; phone: string;
  credit_limit_usd: number; created_at: string;
};

type Account = {
  id: string; customer_id: string; type: string;
  balance: number; currency: string; updated_at: string;
};

type Bill = {
  id: string; customer_id: string; description: string;
  amount: number; due_date: string; paid: number; paid_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-md">{msg}</div>;
}

function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {cols.map((c) => <th key={c} className="px-3 py-2 text-left">{c}</th>)}
      </tr>
    </thead>
  );
}

// ── Customers tab ─────────────────────────────────────────────────────────────

const emptyCustomer = { name: "", email: "", phone: "", credit_limit_usd: 500 };

function CustomersTab() {
  const [rows, setRows]     = useState<Customer[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]   = useState<Partial<Customer>>({});
  const [form, setForm]     = useState({ ...emptyCustomer });

  const load = async () => {
    const res = await fetch(`${API}/customers`);
    if (!res.ok) { setError("Failed to load"); return; }
    setRows(await res.json());
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    const res = await fetch(`${API}/customers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (!res.ok) { const e = await res.json(); setError(e.error); return; }
    setError(null); setForm({ ...emptyCustomer }); load();
  };

  const save = async (id: string) => {
    if (!Object.keys(draft).length) { setEditing(null); return; }
    const res = await fetch(`${API}/customers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!res.ok) { const e = await res.json(); setError(e.error); return; }
    setError(null); setEditing(null); setDraft({}); load();
  };

  const del = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    await fetch(`${API}/customers/${id}`, { method: "DELETE" });
    load();
  };

  const numField = (k: keyof typeof emptyCustomer) => k === "credit_limit_usd";

  return (
    <>
      <Err msg={error} />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <THead cols={["ID","Name","Email","Phone","Credit Limit (USD)","Created At","Actions"]} />
            <tbody>
              {/* New row */}
              <tr className="border-b bg-primary/5">
                <td className="px-3 py-2 text-xs text-muted-foreground italic">auto</td>
                {(["name","email","phone"] as const).map((k) => (
                  <td key={k} className="px-3 py-2">
                    <Input className="h-7 text-xs" placeholder={k} value={form[k]}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <Input className="h-7 text-xs" type="number" value={form.credit_limit_usd}
                    onChange={(e) => setForm((f) => ({ ...f, credit_limit_usd: Number(e.target.value) }))} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground italic">auto</td>
                <td className="px-3 py-2">
                  <Button size="sm" className="h-6 text-xs px-2" onClick={add}>Add</Button>
                </td>
              </tr>
              {rows.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/50">
                  {(["id","name","email","phone","credit_limit_usd","created_at"] as (keyof Customer)[]).map((k) => (
                    <td key={k} className="px-3 py-2 text-sm">
                      {editing === c.id && k !== "id" && k !== "created_at" ? (
                        <Input className="h-7 text-xs" type={numField(k as any) ? "number" : "text"}
                          value={String(draft[k] ?? c[k])}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: numField(k as any) ? Number(e.target.value) : e.target.value }))} />
                      ) : <span>{String(c[k])}</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {editing === c.id ? (
                        <>
                          <Button size="sm" className="h-6 text-xs px-2" onClick={() => save(c.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditing(null); setDraft({}); }}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setEditing(c.id); setDraft({}); }}>Edit</Button>
                          <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => del(c.id)}>Del</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

// ── Accounts tab ──────────────────────────────────────────────────────────────

const emptyAccount = { customer_id: "", type: "checking", balance: 0, currency: "USD" };

function AccountsTab() {
  const [rows, setRows]       = useState<Account[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState<Partial<Account>>({});
  const [form, setForm]       = useState({ ...emptyAccount });

  const load = async () => {
    const res = await fetch(`${API}/accounts`);
    if (!res.ok) { setError("Failed to load"); return; }
    setRows(await res.json());
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    const res = await fetch(`${API}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (!res.ok) { const e = await res.json(); setError(e.error); return; }
    setError(null); setForm({ ...emptyAccount }); load();
  };

  const save = async (id: string) => {
    if (!Object.keys(draft).length) { setEditing(null); return; }
    const res = await fetch(`${API}/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!res.ok) { const e = await res.json(); setError(e.error); return; }
    setError(null); setEditing(null); setDraft({}); load();
  };

  const del = async (id: string) => {
    if (!confirm(`Delete account ${id}?`)) return;
    await fetch(`${API}/accounts/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <Err msg={error} />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <THead cols={["ID","Customer ID","Type","Balance","Currency","Updated At","Actions"]} />
            <tbody>
              {/* New row */}
              <tr className="border-b bg-primary/5">
                <td className="px-3 py-2 text-xs text-muted-foreground italic">auto</td>
                <td className="px-3 py-2">
                  <Input className="h-7 text-xs" placeholder="cust_001" value={form.customer_id}
                    onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} />
                </td>
                <td className="px-3 py-2">
                  <select className="h-7 text-xs border rounded px-1 bg-background" value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                    {["checking","savings","credit"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Input className="h-7 text-xs" type="number" value={form.balance}
                    onChange={(e) => setForm((f) => ({ ...f, balance: Number(e.target.value) }))} />
                </td>
                <td className="px-3 py-2">
                  <Input className="h-7 text-xs" value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground italic">auto</td>
                <td className="px-3 py-2">
                  <Button size="sm" className="h-6 text-xs px-2" onClick={add}>Add</Button>
                </td>
              </tr>
              {rows.map((a) => (
                <tr key={a.id} className="border-b hover:bg-muted/50">
                  {(["id","customer_id","type","balance","currency","updated_at"] as (keyof Account)[]).map((k) => (
                    <td key={k} className="px-3 py-2 text-sm">
                      {editing === a.id && (k === "balance" || k === "currency") ? (
                        <Input className="h-7 text-xs" type={k === "balance" ? "number" : "text"}
                          value={String(draft[k] ?? a[k])}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: k === "balance" ? Number(e.target.value) : e.target.value }))} />
                      ) : <span>{String(a[k])}</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {editing === a.id ? (
                        <>
                          <Button size="sm" className="h-6 text-xs px-2" onClick={() => save(a.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditing(null); setDraft({}); }}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setEditing(a.id); setDraft({}); }}>Edit</Button>
                          <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => del(a.id)}>Del</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

// ── Bills tab ─────────────────────────────────────────────────────────────────

const emptyBill = { customer_id: "", description: "", amount: 0, due_date: "", paid: 0 };

function BillsTab() {
  const [rows, setRows]       = useState<Bill[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState<Partial<Bill>>({});
  const [form, setForm]       = useState({ ...emptyBill });

  const load = async () => {
    const res = await fetch(`${API}/bills`);
    if (!res.ok) { setError("Failed to load"); return; }
    setRows(await res.json());
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    const res = await fetch(`${API}/bills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (!res.ok) { const e = await res.json(); setError(e.error); return; }
    setError(null); setForm({ ...emptyBill }); load();
  };

  const save = async (id: string) => {
    if (!Object.keys(draft).length) { setEditing(null); return; }
    const res = await fetch(`${API}/bills/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!res.ok) { const e = await res.json(); setError(e.error); return; }
    setError(null); setEditing(null); setDraft({}); load();
  };

  const del = async (id: string) => {
    if (!confirm(`Delete bill ${id}?`)) return;
    await fetch(`${API}/bills/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <Err msg={error} />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <THead cols={["ID","Customer ID","Description","Amount","Due Date","Paid","Paid At","Actions"]} />
            <tbody>
              {/* New row */}
              <tr className="border-b bg-primary/5">
                <td className="px-3 py-2 text-xs text-muted-foreground italic">auto</td>
                {([
                  { k: "customer_id", ph: "cust_001" },
                  { k: "description", ph: "Internet - Jul" },
                ] as { k: keyof typeof emptyBill; ph: string }[]).map(({ k, ph }) => (
                  <td key={k} className="px-3 py-2">
                    <Input className="h-7 text-xs" placeholder={ph} value={String(form[k])}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <Input className="h-7 text-xs" type="number" placeholder="0.00" value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} />
                </td>
                <td className="px-3 py-2">
                  <Input className="h-7 text-xs" type="date" value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={form.paid === 1}
                    onChange={(e) => setForm((f) => ({ ...f, paid: e.target.checked ? 1 : 0 }))} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground italic">—</td>
                <td className="px-3 py-2">
                  <Button size="sm" className="h-6 text-xs px-2" onClick={add}>Add</Button>
                </td>
              </tr>
              {rows.map((b) => (
                <tr key={b.id} className="border-b hover:bg-muted/50">
                  <td className="px-3 py-2 text-sm">{b.id}</td>
                  <td className="px-3 py-2 text-sm">{b.customer_id}</td>
                  {(["description","amount","due_date"] as (keyof Bill)[]).map((k) => (
                    <td key={k} className="px-3 py-2 text-sm">
                      {editing === b.id ? (
                        <Input className="h-7 text-xs" type={k === "amount" ? "number" : "text"}
                          value={String(draft[k] ?? b[k])}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: k === "amount" ? Number(e.target.value) : e.target.value }))} />
                      ) : <span>{String(b[k])}</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-sm">
                    {editing === b.id ? (
                      <input type="checkbox" checked={(draft.paid ?? b.paid) === 1}
                        onChange={(e) => setDraft((d) => ({ ...d, paid: e.target.checked ? 1 : 0 }))} />
                    ) : <span className={(b.paid ? "text-green-600" : "text-red-500")}>{b.paid ? "Yes" : "No"}</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-muted-foreground">{b.paid_at ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {editing === b.id ? (
                        <>
                          <Button size="sm" className="h-6 text-xs px-2" onClick={() => save(b.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setEditing(null); setDraft({}); }}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setEditing(b.id); setDraft({}); }}>Edit</Button>
                          <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => del(b.id)}>Del</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "customers" | "accounts" | "bills";

export default function DbPage() {
  const [tab, setTab] = useState<Tab>("customers");

  const tabs: { id: Tab; label: string }[] = [
    { id: "customers", label: "Customers" },
    { id: "accounts",  label: "Accounts" },
    { id: "bills",     label: "Bills" },
  ];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">CorpDB</h1>
          <p className="text-sm text-muted-foreground">Database management</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "customers" && <CustomersTab />}
        {tab === "accounts"  && <AccountsTab />}
        {tab === "bills"     && <BillsTab />}
      </div>
    </div>
  );
}

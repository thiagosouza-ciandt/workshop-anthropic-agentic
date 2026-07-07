const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "corpdb.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run seed on startup so the container is self-contained
require("./seed");

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Customers ────────────────────────────────────────────────────────────────

// GET /customers
// Returns all customers
app.get("/customers", (_req, res) => {
  res.json(db.prepare("SELECT * FROM customers ORDER BY created_at DESC").all());
});

// GET /customers/identify?name=Alice%20Johnson&phone=%2B1-555-0101
// Lookup customer by full name + phone (exact match)
// MUST be declared before /customers/:id so Express doesn't treat "identify" as an id
app.get("/customers/identify", (req, res) => {
  const name = String(req.query.name ?? "").trim();
  // '+' is decoded as space by some HTTP clients — normalise to '+<digits>'
  const rawPhone = String(req.query.phone ?? "");
  const phone = rawPhone.replace(/^\s+/, "+").trim();

  if (!name || !phone)
    return res.status(400).json({ error: "name and phone are required" });

  // Normalize both sides to digits only for comparison
  const digitsOnly = (s) => s.replace(/\D/g, "");
  const phoneDigits = digitsOnly(phone);
  const all = db.prepare("SELECT * FROM customers WHERE name = ?").all(name);
  const row = all.find((c) => digitsOnly(c.phone) === phoneDigits) ?? null;

  if (!row) return res.status(404).json({ error: "Customer not found" });
  res.json(row);
});

// POST /customers
// Create a new customer
// Body: { name, email, phone, credit_limit_usd? }
app.post("/customers", (req, res) => {
  const { name, email, phone, credit_limit_usd = 500.0 } = req.body;
  if (!name || !email || !phone)
    return res.status(400).json({ error: "name, email and phone are required" });

  const id = "cust_" + crypto.randomUUID().slice(0, 8);
  try {
    db.prepare(`
      INSERT INTO customers (id, name, email, phone, credit_limit_usd)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name.trim(), email.trim(), phone.trim(), credit_limit_usd);
  } catch (err) {
    if (err.message.includes("UNIQUE"))
      return res.status(409).json({ error: "Email already registered" });
    throw err;
  }

  res.status(201).json(db.prepare("SELECT * FROM customers WHERE id = ?").get(id));
});

// DELETE /customers/:id
app.delete("/customers/:id", (req, res) => {
  const info = db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Customer not found" });
  res.json({ success: true });
});

// PATCH /customers/:id
// Update customer fields
// Body: { name?, email?, phone?, credit_limit_usd? }
app.patch("/customers/:id", (req, res) => {
  const allowed = ["name", "email", "phone", "credit_limit_usd"];
  const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (fields.length === 0)
    return res.status(400).json({ error: "No valid fields to update" });

  const set = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => req.body[f]);
  const info = db.prepare(`UPDATE customers SET ${set} WHERE id = ?`).run(...values, req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Customer not found" });
  res.json(db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id));
});

// GET /customers/:id
// Returns customer profile
app.get("/customers/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "Customer not found" });
  res.json(row);
});

// GET /customers/by-email/:email
// Lookup customer by email
app.get("/customers/by-email/:email", (req, res) => {
  const row = db
    .prepare("SELECT * FROM customers WHERE email = ?")
    .get(req.params.email);
  if (!row) return res.status(404).json({ error: "Customer not found" });
  res.json(row);
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

// GET /accounts
// Returns all accounts
app.get("/accounts", (_req, res) => {
  res.json(db.prepare("SELECT * FROM accounts ORDER BY customer_id").all());
});

// GET /accounts/:customerId
// Returns all accounts for a customer
app.get("/accounts/:customerId", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM accounts WHERE customer_id = ?")
    .all(req.params.customerId);
  res.json(rows);
});

// POST /accounts
// Body: { customer_id, type, balance?, currency? }
app.post("/accounts", (req, res) => {
  const { customer_id, type, balance = 0, currency = "USD" } = req.body;
  if (!customer_id || !type)
    return res.status(400).json({ error: "customer_id and type are required" });
  const id = "acc_" + crypto.randomUUID().slice(0, 8);
  db.prepare("INSERT INTO accounts (id, customer_id, type, balance, currency) VALUES (?, ?, ?, ?, ?)")
    .run(id, customer_id, type, balance, currency);
  res.status(201).json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
});

// PATCH /accounts/:id
// Body: { balance?, currency? }
app.patch("/accounts/:id", (req, res) => {
  const allowed = ["balance", "currency"];
  const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (fields.length === 0) return res.status(400).json({ error: "No valid fields" });
  const set = fields.map((f) => `${f} = ?`).join(", ");
  const info = db.prepare(`UPDATE accounts SET ${set}, updated_at = datetime('now') WHERE id = ?`)
    .run(...fields.map((f) => req.body[f]), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Account not found" });
  res.json(db.prepare("SELECT * FROM accounts WHERE id = ?").get(req.params.id));
});

// DELETE /accounts/:id
app.delete("/accounts/:id", (req, res) => {
  const info = db.prepare("DELETE FROM accounts WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Account not found" });
  res.json({ success: true });
});

// ─── Bills ────────────────────────────────────────────────────────────────────

// GET /bills
// Returns all bills across all customers
app.get("/bills", (_req, res) => {
  res.json(db.prepare("SELECT * FROM bills ORDER BY due_date DESC").all());
});

// POST /bills
// Body: { customer_id, description, amount, due_date, paid? }
app.post("/bills", (req, res) => {
  const { customer_id, description, amount, due_date, paid = 0 } = req.body;
  if (!customer_id || !description || !amount || !due_date)
    return res.status(400).json({ error: "customer_id, description, amount and due_date are required" });
  const id = "bill_" + crypto.randomUUID().slice(0, 8);
  db.prepare("INSERT INTO bills (id, customer_id, description, amount, due_date, paid) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, customer_id, description, amount, due_date, paid ? 1 : 0);
  res.status(201).json(db.prepare("SELECT * FROM bills WHERE id = ?").get(id));
});

// PATCH /bills/:id
// Body: { description?, amount?, due_date?, paid? }
app.patch("/bills/:id", (req, res) => {
  const allowed = ["description", "amount", "due_date", "paid"];
  const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (fields.length === 0) return res.status(400).json({ error: "No valid fields" });
  const set = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => f === "paid" ? (req.body[f] ? 1 : 0) : req.body[f]);
  const info = db.prepare(`UPDATE bills SET ${set} WHERE id = ?`).run(...values, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Bill not found" });
  res.json(db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.id));
});

// DELETE /bills/:id
app.delete("/bills/:id", (req, res) => {
  const info = db.prepare("DELETE FROM bills WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Bill not found" });
  res.json({ success: true });
});

// GET /bills/:customerId
// Returns all bills; optional ?paid=0|1 filter
app.get("/bills/:customerId", (req, res) => {
  const { paid } = req.query;
  let query = "SELECT * FROM bills WHERE customer_id = ?";
  const params = [req.params.customerId];
  if (paid !== undefined) {
    query += " AND paid = ?";
    params.push(paid === "1" ? 1 : 0);
  }
  query += " ORDER BY due_date DESC";
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// POST /bills/:id/pay
// Mark a bill as paid
app.post("/bills/:id/pay", (req, res) => {
  const info = db
    .prepare(
      "UPDATE bills SET paid = 1, paid_at = datetime('now') WHERE id = ? AND paid = 0"
    )
    .run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Bill not found or already paid" });
  res.json({ success: true });
});

// ─── Transactions ─────────────────────────────────────────────────────────────

// GET /transactions/:accountId
// Returns last N transactions for an account
app.get("/transactions/:accountId", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? "10"), 50);
  const rows = db
    .prepare(
      "SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(req.params.accountId, limit);
  res.json(rows);
});

// ─── Loans ────────────────────────────────────────────────────────────────────

// POST /loans
// Request a loan
// Body: { customer_id, amount }
// Returns: loan object — if amount <= customer.credit_limit and status='approved' (agent-auto)
//          else status='pending' (needs human approval)
app.post("/loans", (req, res) => {
  const { customer_id, amount } = req.body;
  if (!customer_id || !amount)
    return res.status(400).json({ error: "customer_id and amount required" });

  const customer = db
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(customer_id);
  if (!customer)
    return res.status(404).json({ error: "Customer not found" });

  const AGENT_LIMIT = 500;
  const status = amount <= AGENT_LIMIT ? "approved" : "pending";
  const id = "loan_" + crypto.randomUUID().slice(0, 8);

  db.prepare(`
    INSERT INTO loans (id, customer_id, amount, status, resolved_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, customer_id, amount, status, status === "approved" ? "agent" : null);

  const loan = db.prepare("SELECT * FROM loans WHERE id = ?").get(id);
  res.status(201).json(loan);
});

// GET /loans/:customerId
// Returns all loans for a customer
app.get("/loans/:customerId", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM loans WHERE customer_id = ? ORDER BY requested_at DESC")
    .all(req.params.customerId);
  res.json(rows);
});

// PATCH /loans/:id/resolve
// Human approves or rejects a pending loan
// Body: { decision: 'approved'|'rejected', resolved_by: 'human:Ana', reason?: string }
app.patch("/loans/:id/resolve", (req, res) => {
  const { decision, resolved_by, reason } = req.body;
  if (!["approved", "rejected"].includes(decision))
    return res.status(400).json({ error: "decision must be approved or rejected" });

  const info = db.prepare(`
    UPDATE loans
    SET status = ?, resolved_by = ?, reason = ?, resolved_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(decision, resolved_by, reason ?? null, req.params.id);

  if (info.changes === 0)
    return res.status(404).json({ error: "Loan not found or not pending" });

  res.json(db.prepare("SELECT * FROM loans WHERE id = ?").get(req.params.id));
});

// ─── Pending Handoffs ─────────────────────────────────────────────────────────

// POST /handoffs
// Agent creates a handoff when loan > $500
// Body: { conversation_id, customer_id, loan_id, context }
app.post("/handoffs", (req, res) => {
  const { conversation_id, customer_id, loan_id, context } = req.body;
  if (!conversation_id || !customer_id || !context)
    return res.status(400).json({ error: "conversation_id, customer_id and context required" });

  const id = "hdoff_" + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO pending_handoffs (id, conversation_id, customer_id, loan_id, context)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, conversation_id, customer_id, loan_id ?? null, JSON.stringify(context));

  res.status(201).json(db.prepare("SELECT * FROM pending_handoffs WHERE id = ?").get(id));
});

// GET /handoffs
// Returns all handoffs; optional ?status=waiting|claimed|resolved
app.get("/handoffs", (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT h.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM pending_handoffs h
    JOIN customers c ON c.id = h.customer_id
  `;
  const params = [];
  if (status) {
    query += " WHERE h.status = ?";
    params.push(status);
  }
  query += " ORDER BY h.created_at DESC";
  const rows = db.prepare(query).all(...params);
  res.json(rows.map((r) => ({ ...r, context: JSON.parse(r.context) })));
});

// GET /handoffs/:id
// Returns a single handoff with full context
app.get("/handoffs/:id", (req, res) => {
  const row = db.prepare(`
    SELECT h.*, c.name as customer_name, c.email as customer_email
    FROM pending_handoffs h
    JOIN customers c ON c.id = h.customer_id
    WHERE h.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Handoff not found" });
  res.json({ ...row, context: JSON.parse(row.context) });
});

// PATCH /handoffs/:id/claim
// Human agent claims the handoff
// Body: { claimed_by: 'Ana' }
app.patch("/handoffs/:id/claim", (req, res) => {
  const { claimed_by } = req.body;
  const info = db.prepare(`
    UPDATE pending_handoffs
    SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now')
    WHERE id = ? AND status = 'waiting'
  `).run(claimed_by, req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Handoff not found or already claimed" });
  res.json(db.prepare("SELECT * FROM pending_handoffs WHERE id = ?").get(req.params.id));
});

// PATCH /handoffs/:id/resolve
// Human resolves the handoff (after approving/rejecting loan)
app.patch("/handoffs/:id/resolve", (req, res) => {
  const info = db.prepare(`
    UPDATE pending_handoffs SET status = 'resolved'
    WHERE id = ? AND status IN ('waiting','claimed')
  `).run(req.params.id);
  if (info.changes === 0)
    return res.status(404).json({ error: "Handoff not found or already resolved" });
  res.json({ success: true });
});

// ─── Credit limit ─────────────────────────────────────────────────────────────

// GET /credit/:customerId
// Returns current credit limit and available credit
app.get("/credit/:customerId", (req, res) => {
  const customer = db
    .prepare("SELECT id, name, credit_limit_usd FROM customers WHERE id = ?")
    .get(req.params.customerId);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const activeLoans = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM loans WHERE customer_id = ? AND status = 'active'
  `).get(req.params.customerId);

  res.json({
    customer_id: customer.id,
    customer_name: customer.name,
    credit_limit_usd: customer.credit_limit_usd,
    used_credit_usd: activeLoans.total,
    available_credit_usd: customer.credit_limit_usd - activeLoans.total,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CorpDB API running on port ${PORT}`));

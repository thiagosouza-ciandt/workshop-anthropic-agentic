const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "corpdb.sqlite");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    email            TEXT UNIQUE NOT NULL,
    phone            TEXT,
    credit_limit_usd REAL NOT NULL DEFAULT 500.00,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id           TEXT PRIMARY KEY,
    customer_id  TEXT NOT NULL REFERENCES customers(id),
    type         TEXT NOT NULL,                  -- checking | savings | credit
    balance      REAL NOT NULL DEFAULT 0.00,
    currency     TEXT NOT NULL DEFAULT 'USD',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bills (
    id           TEXT PRIMARY KEY,
    customer_id  TEXT NOT NULL REFERENCES customers(id),
    description  TEXT NOT NULL,
    amount       REAL NOT NULL,
    due_date     TEXT NOT NULL,
    paid         INTEGER NOT NULL DEFAULT 0,     -- 0 = unpaid, 1 = paid
    paid_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id),
    type         TEXT NOT NULL,                  -- credit | debit
    amount       REAL NOT NULL,
    description  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loans (
    id           TEXT PRIMARY KEY,
    customer_id  TEXT NOT NULL REFERENCES customers(id),
    amount       REAL NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | active
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at  TEXT,
    resolved_by  TEXT,                            -- 'agent' | 'human:<name>'
    reason       TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_handoffs (
    id            TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    customer_id   TEXT NOT NULL REFERENCES customers(id),
    loan_id       TEXT REFERENCES loans(id),
    context       TEXT NOT NULL,                 -- JSON: full conversation + agent reasoning
    status        TEXT NOT NULL DEFAULT 'waiting', -- waiting | claimed | resolved
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    claimed_by    TEXT,
    claimed_at    TEXT
  );
`);

// ─── Seed data ────────────────────────────────────────────────────────────────

const customers = [
  {
    id: "cust_001",
    name: "Alice Johnson",
    email: "alice@example.com",
    phone: "+1-555-0101",
    credit_limit_usd: 2000.0,
  },
  {
    id: "cust_002",
    name: "Bob Smith",
    email: "bob@example.com",
    phone: "+1-555-0102",
    credit_limit_usd: 500.0,
  },
  {
    id: "cust_003",
    name: "Carol Martinez",
    email: "carol@example.com",
    phone: "+1-555-0103",
    credit_limit_usd: 10000.0,
  },
  {
    id: "cust_004",
    name: "David Lee",
    email: "david@example.com",
    phone: "+1-555-0104",
    credit_limit_usd: 500.0,
  },
];

const accounts = [
  { id: "acc_001a", customer_id: "cust_001", type: "checking", balance: 3420.5 },
  { id: "acc_001b", customer_id: "cust_001", type: "savings",  balance: 12000.0 },
  { id: "acc_001c", customer_id: "cust_001", type: "credit",   balance: -340.0 },
  { id: "acc_002a", customer_id: "cust_002", type: "checking", balance: 180.75 },
  { id: "acc_002b", customer_id: "cust_002", type: "credit",   balance: -490.0 },
  { id: "acc_003a", customer_id: "cust_003", type: "checking", balance: 52000.0 },
  { id: "acc_003b", customer_id: "cust_003", type: "savings",  balance: 200000.0 },
  { id: "acc_004a", customer_id: "cust_004", type: "checking", balance: 45.0 },
];

const bills = [
  // Alice — mix of paid and unpaid
  { id: "bill_001", customer_id: "cust_001", description: "Internet - May",   amount: 89.99,  due_date: "2025-05-10", paid: 1, paid_at: "2025-05-08" },
  { id: "bill_002", customer_id: "cust_001", description: "Internet - Jun",   amount: 89.99,  due_date: "2025-06-10", paid: 0 },
  { id: "bill_003", customer_id: "cust_001", description: "Insurance - Jun",  amount: 210.00, due_date: "2025-06-15", paid: 0 },
  // Bob — past due
  { id: "bill_004", customer_id: "cust_002", description: "Credit card - Apr", amount: 320.00, due_date: "2025-04-20", paid: 0 },
  { id: "bill_005", customer_id: "cust_002", description: "Credit card - May", amount: 490.00, due_date: "2025-05-20", paid: 0 },
  // Carol — all paid
  { id: "bill_006", customer_id: "cust_003", description: "Premium plan - Jun", amount: 499.00, due_date: "2025-06-01", paid: 1, paid_at: "2025-05-30" },
  // David — past due, low balance
  { id: "bill_007", customer_id: "cust_004", description: "Utility - May",    amount: 75.50,  due_date: "2025-05-25", paid: 0 },
];

const transactions = [
  { id: "tx_001", account_id: "acc_001a", type: "credit", amount: 5000.0, description: "Salary deposit",         created_at: "2025-06-01" },
  { id: "tx_002", account_id: "acc_001a", type: "debit",  amount: 89.99,  description: "Internet bill payment",  created_at: "2025-06-02" },
  { id: "tx_003", account_id: "acc_001a", type: "debit",  amount: 1200.0, description: "Rent payment",           created_at: "2025-06-03" },
  { id: "tx_004", account_id: "acc_002a", type: "credit", amount: 1500.0, description: "Salary deposit",         created_at: "2025-06-01" },
  { id: "tx_005", account_id: "acc_002a", type: "debit",  amount: 490.0,  description: "Credit card payment",    created_at: "2025-06-02" },
  { id: "tx_006", account_id: "acc_002a", type: "debit",  amount: 320.0,  description: "Credit card payment",    created_at: "2025-06-10" },
  { id: "tx_007", account_id: "acc_003a", type: "credit", amount: 25000.0, description: "Business revenue",      created_at: "2025-06-01" },
  { id: "tx_008", account_id: "acc_004a", type: "credit", amount: 200.0,  description: "Transfer in",            created_at: "2025-06-05" },
  { id: "tx_009", account_id: "acc_004a", type: "debit",  amount: 155.0,  description: "Groceries",              created_at: "2025-06-10" },
];

// ─── Insert (idempotent) ──────────────────────────────────────────────────────

const insertCustomer = db.prepare(`
  INSERT OR IGNORE INTO customers (id, name, email, phone, credit_limit_usd)
  VALUES (@id, @name, @email, @phone, @credit_limit_usd)
`);
const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO accounts (id, customer_id, type, balance)
  VALUES (@id, @customer_id, @type, @balance)
`);
const insertBill = db.prepare(`
  INSERT OR IGNORE INTO bills (id, customer_id, description, amount, due_date, paid, paid_at)
  VALUES (@id, @customer_id, @description, @amount, @due_date, @paid, @paid_at)
`);
const insertTx = db.prepare(`
  INSERT OR IGNORE INTO transactions (id, account_id, type, amount, description, created_at)
  VALUES (@id, @account_id, @type, @amount, @description, @created_at)
`);

const seedAll = db.transaction(() => {
  for (const c of customers) insertCustomer.run(c);
  for (const a of accounts)  insertAccount.run(a);
  for (const b of bills)     insertBill.run({ paid_at: null, ...b });
  for (const t of transactions) insertTx.run(t);
});

seedAll();
console.log("✅ Database seeded successfully");
db.close();

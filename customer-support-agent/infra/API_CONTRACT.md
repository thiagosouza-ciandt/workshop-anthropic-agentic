# CorpDB API — Contract

Base URL: `http://localhost:3001`

---

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |

---

## Customers

| Method | Path | Description |
|---|---|---|
| POST | `/customers` | Create a new customer |
| GET | `/customers/:id` | Customer profile by ID |
| GET | `/customers/by-email/:email` | Lookup by email |
| GET | `/customers/identify?name=Alice+Johnson&phone=+1-555-0101` | Lookup by full name + phone (exact match) |

### POST /customers — Request body
```json
{ "name": "Eve Torres", "email": "eve@example.com", "phone": "+1-555-0105", "credit_limit_usd": 1500.00 }
```
- `credit_limit_usd` is optional (default: 500.00)
- Returns 409 if email already exists


### Response — Customer
```json
{
  "id": "cust_001",
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "phone": "+1-555-0101",
  "credit_limit_usd": 2000.00,
  "created_at": "2025-06-01T00:00:00"
}
```

---

## Accounts

| Method | Path | Description |
|---|---|---|
| GET | `/accounts/:customerId` | All accounts for a customer |

### Response — Account[]
```json
[
  { "id": "acc_001a", "customer_id": "cust_001", "type": "checking", "balance": 3420.50, "currency": "USD" },
  { "id": "acc_001b", "customer_id": "cust_001", "type": "savings",  "balance": 12000.00, "currency": "USD" }
]
```

---

## Bills

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/bills/:customerId` | `?paid=0\|1` | All bills (optional filter by paid status) |
| POST | `/bills/:id/pay` | — | Mark bill as paid |

### Response — Bill[]
```json
[
  {
    "id": "bill_002",
    "customer_id": "cust_001",
    "description": "Internet - Jun",
    "amount": 89.99,
    "due_date": "2025-06-10",
    "paid": 0,
    "paid_at": null
  }
]
```

---

## Transactions

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/transactions/:accountId` | `?limit=10` (max 50) | Recent transactions for an account |

### Response — Transaction[]
```json
[
  {
    "id": "tx_001",
    "account_id": "acc_001a",
    "type": "credit",
    "amount": 5000.00,
    "description": "Salary deposit",
    "created_at": "2025-06-01"
  }
]
```

---

## Loans

| Method | Path | Description |
|---|---|---|
| POST | `/loans` | Request a loan |
| GET | `/loans/:customerId` | All loans for a customer |
| PATCH | `/loans/:id/resolve` | Human approves or rejects a pending loan |

### POST /loans — Request body
```json
{ "customer_id": "cust_001", "amount": 1000.00 }
```

### POST /loans — Response
- `amount <= 500` → `status: "approved"`, `resolved_by: "agent"` (auto)
- `amount > 500`  → `status: "pending"` (needs human via handoff)

```json
{
  "id": "loan_abc12345",
  "customer_id": "cust_001",
  "amount": 1000.00,
  "status": "pending",
  "requested_at": "2025-06-15T10:00:00",
  "resolved_at": null,
  "resolved_by": null,
  "reason": null
}
```

### PATCH /loans/:id/resolve — Request body
```json
{
  "decision": "approved",
  "resolved_by": "human:Ana",
  "reason": "Customer has good credit history"
}
```

---

## Credit

| Method | Path | Description |
|---|---|---|
| GET | `/credit/:customerId` | Credit limit and available credit |

### Response
```json
{
  "customer_id": "cust_001",
  "customer_name": "Alice Johnson",
  "credit_limit_usd": 2000.00,
  "used_credit_usd": 0.00,
  "available_credit_usd": 2000.00
}
```

---

## Handoffs (Human-in-the-loop)

| Method | Path | Query | Description |
|---|---|---|---|
| POST | `/handoffs` | — | Agent creates handoff for loan > $500 |
| GET | `/handoffs` | `?status=waiting\|claimed\|resolved` | All handoffs (backoffice) |
| GET | `/handoffs/:id` | — | Single handoff with full context |
| PATCH | `/handoffs/:id/claim` | — | Human claims the handoff |
| PATCH | `/handoffs/:id/resolve` | — | Human resolves after loan decision |

### POST /handoffs — Request body
```json
{
  "conversation_id": "conv_xyz",
  "customer_id": "cust_001",
  "loan_id": "loan_abc12345",
  "context": {
    "messages": [...],
    "agent_reasoning": "Loan amount $1000 exceeds agent limit of $500",
    "customer_summary": "Premium plan, good payment history"
  }
}
```

### GET /handoffs — Response
```json
[
  {
    "id": "hdoff_abc123",
    "conversation_id": "conv_xyz",
    "customer_id": "cust_001",
    "customer_name": "Alice Johnson",
    "customer_email": "alice@example.com",
    "customer_plan": "premium",
    "loan_id": "loan_abc12345",
    "context": { ... },
    "status": "waiting",
    "created_at": "2025-06-15T10:00:00",
    "claimed_by": null,
    "claimed_at": null
  }
]
```

### PATCH /handoffs/:id/claim — Request body
```json
{ "claimed_by": "Ana" }
```

---

## Synthetic dataset

| Customer | Credit Limit (USD) | Scenario |
|---|---|---|
| Alice Johnson (`cust_001`) | $2,000 | Open bills, good history |
| Bob Smith (`cust_002`) | $500 | Overdue bills, low limit |
| Carol Martinez (`cust_003`) | $10,000 | All paid, healthy balance |
| David Lee (`cust_004`) | $500 | Low balance, overdue bill |

**Identify via name + phone:**

| Name | Phone |
|---|---|
| Alice Johnson | +1-555-0101 |
| Bob Smith | +1-555-0102 |
| Carol Martinez | +1-555-0103 |
| David Lee | +1-555-0104 |

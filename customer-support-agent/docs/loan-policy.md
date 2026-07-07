# CorpBank — Loan Policy

## Auto-approval limits

Loans are processed as follows:

- **Up to $500**: approved automatically by the AI agent, no human review required.
- **$501 to customer's credit limit**: registered as pending and requires human agent approval.
- **Above customer's credit limit**: denied by the AI agent. Customer may request a credit limit review by escalating to a human agent.

## Interest rates

| Loan Amount | Term | Annual Rate |
|---|---|---|
| Up to $500 | Up to 12 months | 8.5% |
| $501 – $2,000 | Up to 24 months | 11.0% |
| $2,001 – $10,000 | Up to 48 months | 13.5% |
| Above $10,000 | Up to 60 months | 16.0% |

## Repayment

- Repayments are made monthly via automatic debit from the customer's checking account.
- There is no penalty for early repayment.
- A late payment fee of $25 applies if a payment is missed.

## Eligibility

- Customer must be an active account holder.
- Customer must have no loans in `pending` status at the time of application.
- Customers with overdue bills may be subject to a higher interest rate.

## Exception process

If a customer requests an amount above their credit limit, a human agent may approve an exception based on:
- Payment history (no overdue bills in the last 12 months)
- Account tenure (customer for more than 2 years)
- Available balance in savings account as collateral

Exceptions must be documented with a reason in the loan record.

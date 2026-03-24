---
name: Stripe invoice integration planned
description: When Stripe is integrated, Skyler should be able to create and send invoices directly — currently she drafts invoice details via email instead
type: project
---

Stripe integration is planned for Skyler. When integrated:
- Add a `create_invoice` action type to the reasoning engine's decision schema
- Add invoice creation to execute-decision.ts using Stripe API
- Skyler should be able to generate and send invoices when a deal reaches proposal/invoice stage
- Until then, Skyler drafts emails containing invoice details or follows user instructions on where to draft

# Sample MRD for the order service

> Used by integration tests. NOT a real product MRD.

## Background

The order service currently has a synchronous `createOrder` endpoint that
calls payment and inventory in a single transaction. As load grows we
see timeouts and partial state when one of the downstream services
stalls.

## Goal

Split the createOrder flow into:
1. Validate the request and write a `pending` order.
2. Asynchronously call payment, then inventory, then mark `paid` or
   `failed`.
3. Always roll back the order status on payment timeout.

## Functional requirements

- FR-001: `POST /orders` returns `202 Accepted` with an `orderId` as
  soon as the `pending` row is written.
- FR-002: The status transitions are exactly: `pending -> paid`,
  `pending -> failed`. No other transitions are allowed.
- FR-003: If payment returns a timeout (HTTP 504 or no response within
  5s), the order MUST be marked `failed` and a compensating event
  published.
- FR-004: The `failed` transition publishes an event
  `order.failed.v1` to the message bus.

## Non-functional

- NFR-001: p99 latency on `POST /orders` < 200ms.
- NFR-002: Order status rollback MUST complete within 30s of payment
  timeout.

## Out of scope

- Refunds (separate ticket).
- Multi-currency support.

## Open questions

- Q1: Should `failed` orders be kept in the table for 30 days?
- Q2: Which message-bus topic? `order.events` or a new one?

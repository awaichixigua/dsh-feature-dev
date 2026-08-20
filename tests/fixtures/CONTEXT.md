# Order service knowledge base — CONTEXT (L0)

> L0 summary, ≤ 200 lines. Detail is in 01/02/03 layer docs.

## Business purpose

`order-service` is the system of record for customer orders. It owns the
`order` and `order_item` tables and emits order events.

## Key entities

- `order` (id, customer_id, status, total_amount, created_at, updated_at)
- `order_item` (id, order_id, sku, qty, price)
- `order_event` (audit trail)

## Status state machine

```
PENDING -> PAID
PENDING -> FAILED
PAID    -> REFUNDED (separate ticket)
```

No other transitions are allowed.

## Public APIs

- `POST /orders` — create order, return `202` + `orderId`
- `GET  /orders/{id}` — read order
- `POST /orders/{id}/cancel` — cancel a `PENDING` order

## Downstream

- `payment-service` — synchronous HTTP, 5s timeout
- `inventory-service` — synchronous HTTP, 3s timeout
- Message bus — publishes `order.events` topic

## Key code locations

- `src/main/java/.../OrderService.java` — order lifecycle
- `src/main/java/.../OrderController.java` — HTTP entry
- `src/main/java/.../OrderStateMachine.java` — transitions

## Conventions

- Layered architecture: controller / service / repository.
- JPA entities with explicit `@Column(name=...)`.
- Mock-first tests; avoid running real downstream in unit tests.

## Test strategy

- Unit tests: all service classes, ≥ 80% branch coverage on new code.
- Integration tests: Testcontainers for Postgres.
- E2E: contract tests against `payment-service` and `inventory-service`.

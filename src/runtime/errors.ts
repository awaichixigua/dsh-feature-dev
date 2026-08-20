/**
 * Domain errors. All throwable failures in this bundle inherit from
 * FeatureDevError so the Tool layer can convert them to a stable
 * JSON-RPC error shape.
 */

export abstract class FeatureDevError extends Error {
  abstract readonly code: string;
  readonly kind: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(kind: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FeatureDevError';
    this.kind = kind;
    this.details = details;
  }
}

export class ValidationError extends FeatureDevError {
  readonly code = 'E_VALIDATION';
  constructor(message: string, details?: Record<string, unknown>) {
    super('validation', message, details);
  }
}

export class NotFoundError extends FeatureDevError {
  readonly code = 'E_NOT_FOUND';
  constructor(message: string, details?: Record<string, unknown>) {
    super('not_found', message, details);
  }
}

export class ForbiddenError extends FeatureDevError {
  readonly code = 'E_FORBIDDEN';
  /** Path escape or policy violation. */
  constructor(message: string, details?: Record<string, unknown>) {
    super('forbidden', message, details);
  }
}

export class ConflictError extends FeatureDevError {
  readonly code = 'E_CONFLICT';
  constructor(message: string, details?: Record<string, unknown>) {
    super('conflict', message, details);
  }
}

export class StateMachineError extends FeatureDevError {
  readonly code = 'E_STATE_MACHINE';
  constructor(message: string, details?: Record<string, unknown>) {
    super('state_machine', message, details);
  }
}

export class GateError extends FeatureDevError {
  readonly code = 'E_GATE';
  constructor(message: string, details?: Record<string, unknown>) {
    super('gate', message, details);
  }
}

export class DshCompatibilityError extends FeatureDevError {
  readonly code = 'E_DSH_COMPAT';
  constructor(message: string, details?: Record<string, unknown>) {
    super('dsh_compat', message, details);
  }
}

export class ExecutorError extends FeatureDevError {
  readonly code = 'E_EXECUTOR';
  constructor(message: string, details?: Record<string, unknown>) {
    super('executor', message, details);
  }
}

export function isFeatureDevError(e: unknown): e is FeatureDevError {
  return e instanceof FeatureDevError;
}

export function toErrorPayload(e: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (isFeatureDevError(e)) {
    return { code: e.code, message: e.message, details: e.details };
  }
  if (e instanceof Error) {
    return { code: 'E_INTERNAL', message: e.message };
  }
  return { code: 'E_INTERNAL', message: String(e) };
}

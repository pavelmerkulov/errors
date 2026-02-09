import { err, ok, Result, ResultAsync } from 'neverthrow';

// Re-export neverthrow essentials
export { err, ok, Result, ResultAsync } from 'neverthrow';

/**
 * Base error class with Go-style error chaining.
 * Use standalone `isError()` / `asError()` to query the cause chain.
 */
export class AppError extends Error {
  override readonly cause?: AppError;

  constructor(
    message: string,
    cause?: AppError
  ) {
    super(message);
    this.cause = cause;
    this.name = this.constructor.name;

    // Capture stack trace, excluding the constructor
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get the tag (class name) for this error.
   */
  get tag(): string {
    return this.constructor.name;
  }

  /**
   * Wrap this error with additional context.
   * Returns a new AppError with this error as the cause.
   */
  wrap(message: string): AppError {
    return new AppError(message, this);
  }

  /**
   * Get a simple chain of error messages.
   */
  chain(): string {
    const messages: string[] = [`[${this.tag}] ${this.message}`];
    let current: AppError | undefined = this.cause;
    while (current) {
      messages.push(`[${current.tag}] ${current.message}`);
      current = current.cause;
    }
    return messages.join(' -> ');
  }

  /**
   * Get the full stack trace including all causes.
   * Similar to Java/Python exception chaining.
   */
  fullStack(): string {
    const stacks: string[] = [];
    let current: AppError | undefined = this;
    let depth = 0;

    while (current) {
      const prefix = depth === 0 ? '' : '\nCaused by: ';
      stacks.push(`${prefix}[${current.tag}] ${current.stack}`);
      current = current.cause;
      depth++;
    }

    return stacks.join('');
  }

  /**
   * Get the root cause of this error chain.
   */
  rootCause(): AppError {
    let current: AppError = this;
    while (current.cause) {
      current = current.cause;
    }
    return current;
  }

  /**
   * Get all errors in the chain as an array.
   */
  chainArray(): AppError[] {
    const errors: AppError[] = [this];
    let current = this.cause;
    while (current) {
      errors.push(current);
      current = current.cause;
    }
    return errors;
  }

  /**
   * Convert to a structured object for logging/serialization.
   */
  toJSON(): ErrorJSON {
    return {
      tag: this.tag,
      name: this.name,
      message: this.message,
      stack: this.stack,
      cause: this.cause?.toJSON(),
    };
  }
}

export interface ErrorJSON {
  tag: string;
  name: string;
  message: string;
  stack?: string;
  cause?: ErrorJSON;
}

// Common error types

export class NotFoundError extends AppError {
  constructor(
    public readonly resource: string,
    public readonly id?: string,
    cause?: AppError
  ) {
    super(id ? `${resource} with id '${id}' not found` : `${resource} not found`, cause);
  }
}

export class ValidationError extends AppError {
  constructor(
    public readonly field: string,
    public readonly reason: string,
    cause?: AppError
  ) {
    super(`${field}: ${reason}`, cause);
  }
}

export class DatabaseError extends AppError {
  constructor(
    public readonly operation: string,
    message: string,
    cause?: AppError
  ) {
    super(`${operation}: ${message}`, cause);
  }
}

export class NetworkError extends AppError {
  constructor(
    public readonly url: string,
    public readonly statusCode?: number,
    message?: string,
    cause?: AppError
  ) {
    const msg = message ?? (statusCode ? `HTTP ${statusCode}` : 'Network error');
    super(`${url}: ${msg}`, cause);
  }
}

export class PermissionError extends AppError {
  constructor(
    public readonly action: string,
    public readonly resource?: string,
    cause?: AppError
  ) {
    const msg = resource ? `Cannot ${action} on ${resource}` : `Permission denied: ${action}`;
    super(msg, cause);
  }
}

export class TimeoutError extends AppError {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
    cause?: AppError
  ) {
    super(`${operation} timed out after ${timeoutMs}ms`, cause);
  }
}

export class ConflictError extends AppError {
  constructor(
    public readonly resource: string,
    message: string,
    cause?: AppError
  ) {
    super(`${resource}: ${message}`, cause);
  }
}

export class UnexpectedError extends AppError {
  constructor(message: string, cause?: AppError) {
    super(message, cause);
  }
}

// Standalone error chain query functions (Go-style errors.Is / errors.As)

/**
 * Check if an error or any in its cause chain is an instance of the given class.
 * Works on any Error with a `cause` chain, not just AppError.
 */
export function isError<E extends AppError>(
  error: unknown,
  errorClass: new (...args: any[]) => E
): boolean {
  if (error instanceof errorClass) return true;
  if (error instanceof Error && error.cause) {
    return isError(error.cause, errorClass);
  }
  return false;
}

/**
 * Find and return the first error in the cause chain that is an instance of the given class.
 * Works on any Error with a `cause` chain, not just AppError.
 */
export function asError<E extends AppError>(
  error: unknown,
  errorClass: new (...args: any[]) => E
): E | undefined {
  if (error instanceof errorClass) return error;
  if (error instanceof Error && error.cause) {
    return asError(error.cause, errorClass);
  }
  return undefined;
}

// Utility functions

/**
 * Create a custom error class with a message factory.
 */
export function createErrorClass<Props extends Record<string, unknown> = {}>(
  name: string,
  messageFactory: (props: Props) => string
) {
  const CustomError = class extends AppError {
    constructor(public readonly props: Props, cause?: AppError) {
      super(messageFactory(props), cause);
    }
  };
  Object.defineProperty(CustomError, 'name', { value: name });
  return CustomError;
}

/**
 * Wrap an unknown error (from try/catch) into an AppError.
 */
export function fromUnknown(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    const appError = new UnexpectedError(error.message);
    appError.stack = error.stack;
    return appError;
  }
  return new UnexpectedError(String(error));
}

/**
 * Try to execute a function and return a Result.
 */
export function tryCatch<T, E extends AppError = AppError>(
  fn: () => T,
  mapError: (error: unknown) => E = (e) => fromUnknown(e) as E
): Result<T, E> {
  try {
    return ok(fn());
  } catch (error) {
    return err(mapError(error));
  }
}

/**
 * Try to execute an async function and return a ResultAsync.
 */
export function tryCatchAsync<T, E extends AppError = AppError>(
  fn: () => Promise<T>,
  mapError: (error: unknown) => E = (e) => fromUnknown(e) as E
): ResultAsync<T, E> {
  return ResultAsync.fromPromise(fn(), mapError);
}

/**
 * Helper to wrap errors in a chain with context.
 */
export function wrapErr<T, E extends AppError>(
  message: string
): (result: Result<T, E>) => Result<T, AppError> {
  return (result) => result.mapErr((e) => e.wrap(message));
}

/**
 * Helper to wrap errors in an async chain with context.
 */
export function wrapErrAsync<T, E extends AppError>(
  message: string
): (result: ResultAsync<T, E>) => ResultAsync<T, AppError> {
  return (result) => result.mapErr((e) => e.wrap(message));
}

// Type helpers for extracting error types from Results
export type ResultOk<R> = R extends Result<infer T, any> ? T : never;
export type ResultErr<R> = R extends Result<any, infer E> ? E : never;
export type ResultAsyncOk<R> = R extends ResultAsync<infer T, any> ? T : never;
export type ResultAsyncErr<R> = R extends ResultAsync<any, infer E> ? E : never;

import { test, expect, describe } from 'bun:test';
import {
  ok,
  err,
  Result,
  ResultAsync,
  AppError,
  NotFoundError,
  ValidationError,
  DatabaseError,
  NetworkError,
  PermissionError,
  TimeoutError,
  ConflictError,
  UnexpectedError,
  createErrorClass,
  fromUnknown,
  tryCatch,
  tryCatchAsync,
  wrapErr,
  wrapErrAsync,
} from './index.ts';

describe('AppError', () => {
  test('creates error with message', () => {
    const error = new AppError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
    expect(error.name).toBe('AppError');
    expect(error.tag).toBe('AppError');
  });

  test('creates error with cause', () => {
    const cause = new AppError('Original error');
    const error = new AppError('Wrapped', cause);
    expect(error.cause).toBe(cause);
  });

  test('captures stack trace', () => {
    const error = new AppError('Test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AppError');
  });

  test('tag is derived from class name', () => {
    const appError = new AppError('test');
    const notFound = new NotFoundError('User');
    const validation = new ValidationError('email', 'invalid');

    expect(appError.tag).toBe('AppError');
    expect(notFound.tag).toBe('NotFoundError');
    expect(validation.tag).toBe('ValidationError');
  });
});

describe('is() - errors.Is equivalent', () => {
  test('returns true for direct instance', () => {
    const error = new NotFoundError('User', '123');
    expect(error.is(NotFoundError)).toBe(true);
  });

  test('returns true for error in cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Connection failed');
    const notFound = new NotFoundError('User', '123', dbError);
    const wrapped = notFound.wrap('Failed to get user');

    expect(wrapped.is(DatabaseError)).toBe(true);
    expect(wrapped.is(NotFoundError)).toBe(true);
    expect(wrapped.is(AppError)).toBe(true);
  });

  test('returns false for error not in chain', () => {
    const error = new NotFoundError('User', '123');
    expect(error.is(DatabaseError)).toBe(false);
    expect(error.is(ValidationError)).toBe(false);
  });
});

describe('as() - errors.As equivalent', () => {
  test('returns error for direct instance', () => {
    const error = new NotFoundError('User', '123');
    const found = error.as(NotFoundError);
    expect(found).toBe(error);
    expect(found?.resource).toBe('User');
    expect(found?.id).toBe('123');
  });

  test('returns error from cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Connection failed');
    const wrapped = dbError.wrap('Failed');

    const found = wrapped.as(DatabaseError);
    expect(found).toBe(dbError);
    expect(found?.operation).toBe('SELECT');
  });

  test('returns undefined for error not in chain', () => {
    const error = new NotFoundError('User', '123');
    expect(error.as(DatabaseError)).toBeUndefined();
  });
});

describe('hasTag()', () => {
  test('returns true for matching tag', () => {
    const error = new NotFoundError('User', '123');
    expect(error.hasTag('NotFoundError')).toBe(true);
  });

  test('returns true for tag in cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Failed');
    const wrapped = dbError.wrap('Wrapped');
    expect(wrapped.hasTag('DatabaseError')).toBe(true);
    expect(wrapped.hasTag('AppError')).toBe(true);
  });

  test('returns false for non-matching tag', () => {
    const error = new NotFoundError('User', '123');
    expect(error.hasTag('DatabaseError')).toBe(false);
  });
});

describe('wrap()', () => {
  test('creates AppError with cause', () => {
    const original = new DatabaseError('SELECT', 'Failed');
    const wrapped = original.wrap('Operation failed');

    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.tag).toBe('AppError');
    expect(wrapped.message).toBe('Operation failed');
    expect(wrapped.cause).toBe(original);
  });

  test('can be chained multiple times', () => {
    const error = new DatabaseError('SELECT', 'Failed')
      .wrap('User lookup failed')
      .wrap('GetUser failed')
      .wrap('Request failed');

    expect(error.chainArray()).toHaveLength(4);
  });
});

describe('chain()', () => {
  test('returns single error message for no cause', () => {
    const error = new NotFoundError('User', '123');
    expect(error.chain()).toBe("[NotFoundError] User with id '123' not found");
  });

  test('returns chained messages', () => {
    const error = new DatabaseError('SELECT', 'Timeout')
      .wrap('Failed to get user');

    expect(error.chain()).toBe('[AppError] Failed to get user -> [DatabaseError] SELECT: Timeout');
  });
});

describe('fullStack()', () => {
  test('includes stack trace', () => {
    const error = new DatabaseError('SELECT', 'Failed');
    const fullStack = error.fullStack();
    expect(fullStack).toContain('[DatabaseError]');
    expect(fullStack).toContain('DatabaseError');
  });

  test('includes caused by for wrapped errors', () => {
    const error = new DatabaseError('SELECT', 'Failed')
      .wrap('Operation failed');

    const fullStack = error.fullStack();
    expect(fullStack).toContain('[AppError]');
    expect(fullStack).toContain('Caused by:');
    expect(fullStack).toContain('[DatabaseError]');
  });
});

describe('rootCause()', () => {
  test('returns self for single error', () => {
    const error = new NotFoundError('User', '123');
    expect(error.rootCause()).toBe(error);
  });

  test('returns deepest cause', () => {
    const root = new DatabaseError('SELECT', 'Connection refused');
    const error = root
      .wrap('Query failed')
      .wrap('GetUser failed');

    expect(error.rootCause()).toBe(root);
  });
});

describe('chainArray()', () => {
  test('returns array of all errors', () => {
    const db = new DatabaseError('SELECT', 'Failed');
    const wrapped = db.wrap('Failed');
    const chain = wrapped.chainArray();

    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe(wrapped);
    expect(chain[1]).toBe(db);
  });
});

describe('toJSON()', () => {
  test('serializes error to JSON', () => {
    const error = new NotFoundError('User', '123');
    const json = error.toJSON();

    expect(json.tag).toBe('NotFoundError');
    expect(json.name).toBe('NotFoundError');
    expect(json.message).toBe("User with id '123' not found");
    expect(json.stack).toBeDefined();
    expect(json.cause).toBeUndefined();
  });

  test('serializes cause chain', () => {
    const error = new DatabaseError('SELECT', 'Failed')
      .wrap('Operation failed');

    const json = error.toJSON();
    expect(json.cause).toBeDefined();
    expect(json.cause?.tag).toBe('DatabaseError');
  });
});

describe('Built-in error types', () => {
  test('NotFoundError', () => {
    const error = new NotFoundError('User', '123');
    expect(error.tag).toBe('NotFoundError');
    expect(error.resource).toBe('User');
    expect(error.id).toBe('123');
    expect(error.message).toBe("User with id '123' not found");
  });

  test('NotFoundError without id', () => {
    const error = new NotFoundError('Config');
    expect(error.message).toBe('Config not found');
    expect(error.id).toBeUndefined();
  });

  test('ValidationError', () => {
    const error = new ValidationError('email', 'must be valid');
    expect(error.tag).toBe('ValidationError');
    expect(error.field).toBe('email');
    expect(error.reason).toBe('must be valid');
  });

  test('DatabaseError', () => {
    const error = new DatabaseError('INSERT', 'Duplicate key');
    expect(error.tag).toBe('DatabaseError');
    expect(error.operation).toBe('INSERT');
  });

  test('NetworkError', () => {
    const error = new NetworkError('https://api.example.com', 503, 'Service unavailable');
    expect(error.tag).toBe('NetworkError');
    expect(error.url).toBe('https://api.example.com');
    expect(error.statusCode).toBe(503);
  });

  test('PermissionError', () => {
    const error = new PermissionError('delete', 'users');
    expect(error.tag).toBe('PermissionError');
    expect(error.action).toBe('delete');
    expect(error.resource).toBe('users');
  });

  test('TimeoutError', () => {
    const error = new TimeoutError('HTTP request', 5000);
    expect(error.tag).toBe('TimeoutError');
    expect(error.operation).toBe('HTTP request');
    expect(error.timeoutMs).toBe(5000);
  });

  test('ConflictError', () => {
    const error = new ConflictError('User', 'Email already exists');
    expect(error.tag).toBe('ConflictError');
    expect(error.resource).toBe('User');
  });

  test('UnexpectedError', () => {
    const error = new UnexpectedError('Something went wrong');
    expect(error.tag).toBe('UnexpectedError');
  });
});

describe('createErrorClass()', () => {
  test('creates custom error class with auto tag from name', () => {
    const RateLimitError = createErrorClass('RateLimitError', (props: { retryAfter: number }) =>
      `Rate limited. Retry after ${props.retryAfter}s`
    );

    const error = new RateLimitError({ retryAfter: 60 });
    expect(error.tag).toBe('RateLimitError');
    expect(error.message).toBe('Rate limited. Retry after 60s');
    expect(error.props.retryAfter).toBe(60);
  });
});

describe('fromUnknown()', () => {
  test('returns AppError as-is', () => {
    const original = new NotFoundError('User', '123');
    const result = fromUnknown(original);
    expect(result).toBe(original);
  });

  test('wraps Error with message', () => {
    const error = new Error('Something failed');
    const result = fromUnknown(error);
    expect(result.message).toBe('Something failed');
    expect(result.tag).toBe('UnexpectedError');
  });

  test('converts string to AppError', () => {
    const result = fromUnknown('string error');
    expect(result.message).toBe('string error');
    expect(result.tag).toBe('UnexpectedError');
  });
});

describe('tryCatch()', () => {
  test('returns ok for successful execution', () => {
    const result = tryCatch(() => 42);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(42);
  });

  test('returns err for thrown error', () => {
    const result = tryCatch(() => {
      throw new Error('Oops');
    });
    expect(result.isErr()).toBe(true);
  });

  test('uses custom error mapper', () => {
    const result = tryCatch(
      () => { throw new Error('Oops'); },
      () => new ValidationError('field', 'invalid')
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });
});

describe('tryCatchAsync()', () => {
  test('returns ok for successful async execution', async () => {
    const result = await tryCatchAsync(async () => 42);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(42);
  });

  test('returns err for rejected promise', async () => {
    const result = await tryCatchAsync(async () => {
      throw new Error('Async oops');
    });
    expect(result.isErr()).toBe(true);
  });
});

describe('wrapErr()', () => {
  test('wraps error in Result', () => {
    const result: Result<number, DatabaseError> = err(new DatabaseError('SELECT', 'Failed'));
    const wrapped = wrapErr<number, DatabaseError>('Operation failed')(result);

    expect(wrapped.isErr()).toBe(true);
    if (wrapped.isErr()) {
      expect(wrapped.error.tag).toBe('AppError');
      expect(wrapped.error.is(DatabaseError)).toBe(true);
    }
  });

  test('passes through ok', () => {
    const result: Result<number, DatabaseError> = ok(42);
    const wrapped = wrapErr<number, DatabaseError>('Operation failed')(result);

    expect(wrapped.isOk()).toBe(true);
    expect(wrapped._unsafeUnwrap()).toBe(42);
  });
});

describe('Integration with neverthrow', () => {
  test('works with Result isOk/isErr', () => {
    const okResult: Result<number, NotFoundError> = ok(42);
    const errResult: Result<number, NotFoundError> = err(new NotFoundError('Item', '1'));

    expect(okResult.isOk()).toBe(true);
    expect(okResult.isErr()).toBe(false);
    expect(errResult.isOk()).toBe(false);
    expect(errResult.isErr()).toBe(true);

    if (errResult.isErr()) {
      expect(errResult.error.tag).toBe('NotFoundError');
    }
  });

  test('works with andThen chaining', () => {
    function step1(): Result<number, ValidationError> {
      return ok(1);
    }

    function step2(n: number): Result<number, DatabaseError> {
      return ok(n + 1);
    }

    const result = step1().andThen(step2);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(2);
  });

  test('error types combine in chain', () => {
    function step1(): Result<number, ValidationError> {
      return err(new ValidationError('input', 'required'));
    }

    function step2(n: number): Result<number, DatabaseError> {
      return ok(n + 1);
    }

    const result: Result<number, ValidationError | DatabaseError> = step1().andThen(step2);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.tag).toBe('ValidationError');
    }
  });
});

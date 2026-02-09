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
  fromUnknown,
  tryCatch,
  tryCatchAsync,
  wrapErr,
  wrapErrAsync,
  isError,
  asError,
} from './index.ts';

describe('AppError', () => {
  test('creates error with message', () => {
    const error = new AppError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
    expect(error.name).toBe('AppError');
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

  test('name is derived from class name', () => {
    const appError = new AppError('test');
    const notFound = new NotFoundError('User');
    const validation = new ValidationError('email', 'invalid');

    expect(appError.name).toBe('AppError');
    expect(notFound.name).toBe('NotFoundError');
    expect(validation.name).toBe('ValidationError');
  });
});

describe('isError() - errors.Is equivalent', () => {
  test('returns true for direct instance', () => {
    const error = new NotFoundError('User', '123');
    expect(isError(error, NotFoundError)).toBe(true);
  });

  test('returns true for error in cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Connection failed');
    const notFound = new NotFoundError('User', '123', dbError);
    const wrapped = notFound.wrap('Failed to get user');

    expect(isError(wrapped, DatabaseError)).toBe(true);
    expect(isError(wrapped, NotFoundError)).toBe(true);
    expect(isError(wrapped, AppError)).toBe(true);
  });

  test('returns false for error not in chain', () => {
    const error = new NotFoundError('User', '123');
    expect(isError(error, DatabaseError)).toBe(false);
    expect(isError(error, ValidationError)).toBe(false);
  });

  test('works on plain Error with cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Failed');
    const plainError = new Error('wrapper', { cause: dbError });

    expect(isError(plainError, DatabaseError)).toBe(true);
    expect(isError(plainError, ValidationError)).toBe(false);
  });

  test('returns false for non-error values', () => {
    expect(isError('string', NotFoundError)).toBe(false);
    expect(isError(null, NotFoundError)).toBe(false);
    expect(isError(42, NotFoundError)).toBe(false);
  });
});

describe('asError() - errors.As equivalent', () => {
  test('returns error for direct instance', () => {
    const error = new NotFoundError('User', '123');
    const found = asError(error, NotFoundError);
    expect(found).toBe(error);
    expect(found?.resource).toBe('User');
    expect(found?.id).toBe('123');
  });

  test('returns error from cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Connection failed');
    const wrapped = dbError.wrap('Failed');
    const found = asError(wrapped, DatabaseError);
    expect(found).toBe(dbError);
    expect(found?.operation).toBe('SELECT');
  });

  test('returns undefined for error not in chain', () => {
    const error = new NotFoundError('User', '123');
    expect(asError(error, DatabaseError)).toBeUndefined();
  });

  test('works on plain Error with cause chain', () => {
    const dbError = new DatabaseError('SELECT', 'Failed');
    const plainError = new Error('wrapper', { cause: dbError });

    const found = asError(plainError, DatabaseError);
    expect(found).toBe(dbError);
    expect(found?.operation).toBe('SELECT');
  });

  test('returns undefined for non-error values', () => {
    expect(asError('string', NotFoundError)).toBeUndefined();
    expect(asError(null, NotFoundError)).toBeUndefined();
  });
});

describe('wrap()', () => {
  test('creates AppError with cause', () => {
    const original = new DatabaseError('SELECT', 'Failed');
    const wrapped = original.wrap('Operation failed');

    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.name).toBe('AppError');
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
    expect(json.cause?.name).toBe('DatabaseError');
  });
});

describe('Built-in error types', () => {
  test('NotFoundError', () => {
    const error = new NotFoundError('User', '123');
    expect(error.name).toBe('NotFoundError');
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
    expect(error.name).toBe('ValidationError');
    expect(error.field).toBe('email');
    expect(error.reason).toBe('must be valid');
  });

  test('DatabaseError', () => {
    const error = new DatabaseError('INSERT', 'Duplicate key');
    expect(error.name).toBe('DatabaseError');
    expect(error.operation).toBe('INSERT');
  });

  test('NetworkError', () => {
    const error = new NetworkError('https://api.example.com', 503, 'Service unavailable');
    expect(error.name).toBe('NetworkError');
    expect(error.url).toBe('https://api.example.com');
    expect(error.statusCode).toBe(503);
  });

  test('PermissionError', () => {
    const error = new PermissionError('delete', 'users');
    expect(error.name).toBe('PermissionError');
    expect(error.action).toBe('delete');
    expect(error.resource).toBe('users');
  });

  test('TimeoutError', () => {
    const error = new TimeoutError('HTTP request', 5000);
    expect(error.name).toBe('TimeoutError');
    expect(error.operation).toBe('HTTP request');
    expect(error.timeoutMs).toBe(5000);
  });

  test('ConflictError', () => {
    const error = new ConflictError('User', 'Email already exists');
    expect(error.name).toBe('ConflictError');
    expect(error.resource).toBe('User');
  });

  test('UnexpectedError', () => {
    const error = new UnexpectedError('Something went wrong');
    expect(error.name).toBe('UnexpectedError');
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
    expect(result.name).toBe('UnexpectedError');
  });

  test('preserves cause chain from plain Error', () => {
    const root = new Error('root cause');
    const wrapper = new Error('wrapper', { cause: root });
    const result = fromUnknown(wrapper);

    expect(result.message).toBe('wrapper');
    expect(result.cause).toBeDefined();
    expect(result.cause!.message).toBe('root cause');
  });

  test('converts string to AppError', () => {
    const result = fromUnknown('string error');
    expect(result.message).toBe('string error');
    expect(result.name).toBe('UnexpectedError');
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
      expect(wrapped.error.name).toBe('AppError');
      expect(isError(wrapped.error, DatabaseError)).toBe(true);
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
      expect(errResult.error.name).toBe('NotFoundError');
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
      expect(result.error.name).toBe('ValidationError');
    }
  });
});

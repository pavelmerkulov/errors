/**
 * Basic usage example demonstrating error chains, isError(), asError(), and stack traces.
 */
import {
  ok,
  err,
  Result,
  AppError,
  NotFoundError,
  ValidationError,
  DatabaseError,
  fromUnknown,
  tryCatch,
  isError,
  asError,
} from '../src/index.ts';

// ============================================================================
// 1. Basic error creation and chaining
// ============================================================================

console.log('=== 1. Basic Error Creation ===\n');

const dbError = new DatabaseError('SELECT', 'Connection refused');
console.log('Database error:', dbError.message);
console.log('Name (auto from class name):', dbError.name);
console.log('');

// Wrap with context
const notFound = new NotFoundError('User', '123', dbError);
console.log('Wrapped error chain:', notFound.chain());
console.log('');

// ============================================================================
// 2. errors.Is() - Check if error type exists in chain
// ============================================================================

console.log('=== 2. errors.Is() equivalent ===\n');

const wrappedError = notFound.wrap('Failed to load user profile');

console.log('Is NotFoundError?', isError(wrappedError, NotFoundError)); // true
console.log('Is DatabaseError?', isError(wrappedError, DatabaseError)); // true
console.log('Is ValidationError?', isError(wrappedError, ValidationError)); // false
console.log('');

// ============================================================================
// 3. errors.As() - Get specific error from chain
// ============================================================================

console.log('=== 3. errors.As() equivalent ===\n');

const foundDbError = asError(wrappedError, DatabaseError);
if (foundDbError) {
  console.log('Found DatabaseError in chain!');
  console.log('  Operation:', foundDbError.operation);
  console.log('  Message:', foundDbError.message);
}

const foundNotFound = asError(wrappedError, NotFoundError);
if (foundNotFound) {
  console.log('Found NotFoundError in chain!');
  console.log('  Resource:', foundNotFound.resource);
  console.log('  ID:', foundNotFound.id);
}

const foundValidation = asError(wrappedError, ValidationError);
console.log('Found ValidationError?', foundValidation !== undefined); // false
console.log('');

// ============================================================================
// 4. Full stack trace
// ============================================================================

console.log('=== 4. Full Stack Trace ===\n');
console.log(wrappedError.fullStack());
console.log('');

// ============================================================================
// 5. Using with Result type
// ============================================================================

console.log('=== 5. Using with Result ===\n');

type User = { id: string; name: string };

function findUser(id: string): Result<User, NotFoundError | DatabaseError> {
  if (id === 'db-error') {
    return err(new DatabaseError('SELECT', 'Connection timeout'));
  }
  if (id === 'not-found') {
    return err(new NotFoundError('User', id));
  }
  return ok({ id, name: 'John Doe' });
}

// Success case
const successResult = findUser('123');
successResult.match(
  (user) => console.log('Found user:', user.name),
  (error) => console.log('Error:', error.message),
);

// Error case - use isError() / asError() for type checking
const errorResult = findUser('not-found');
errorResult.match(
  (user) => console.log('Found user:', user.name),
  (error) => {
    const nf = asError(error, NotFoundError);
    if (nf) {
      console.log('User not found:', nf.resource, nf.id);
      return;
    }
    const db = asError(error, DatabaseError);
    if (db) {
      console.log('Database error:', db.operation);
    }
  },
);
console.log('');

// ============================================================================
// 6. Converting unknown errors
// ============================================================================

console.log('=== 6. Converting Unknown Errors ===\n');

function riskyOperation(): number {
  throw new Error('Something went wrong!');
}

const result = tryCatch(() => riskyOperation());

result.match(
  (value) => console.log('Result:', value),
  (error) => {
    console.log('Caught error:', error.message);
    console.log('Tag:', error.name);
  },
);
console.log('');

// ============================================================================
// 7. JSON serialization for logging
// ============================================================================

console.log('=== 7. JSON Serialization ===\n');

const complexError = new NotFoundError('Order', '456',
  new DatabaseError('SELECT', 'Deadlock detected')
).wrap('Order processing failed');

console.log(JSON.stringify(complexError.toJSON(), null, 2));
console.log('');

// ============================================================================
// 8. Root cause and chain array
// ============================================================================

console.log('=== 8. Root Cause & Chain Array ===\n');

console.log('Root cause:', complexError.rootCause().message);
console.log('Chain length:', complexError.chainArray().length);
console.log('All errors in chain:');
complexError.chainArray().forEach((e, i) => {
  console.log(`  ${i + 1}. [${e.name}] ${e.message}`);
});

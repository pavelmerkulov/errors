/**
 * Async operations example demonstrating ResultAsync usage with error chains.
 */
import {
  ok,
  err,
  ResultAsync,
  AppError,
  NotFoundError,
  NetworkError,
  DatabaseError,
  tryCatchAsync,
  isError,
  asError,
} from '../src/index.ts';

// ============================================================================
// Domain types
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
}

interface ExternalProfile {
  avatarUrl: string;
  bio: string;
}

interface EnrichedUser extends User {
  profile?: ExternalProfile;
}

// ============================================================================
// Simulated async operations
// ============================================================================

function fetchUserFromDb(id: string): ResultAsync<User, DatabaseError> {
  return ResultAsync.fromPromise(
    new Promise<User>((resolve, reject) => {
      setTimeout(() => {
        if (id === 'db-error') reject(new Error('Connection timeout'));
        else if (id === 'not-found') reject(new Error('No rows returned'));
        else resolve({ id, name: 'Alice', email: 'alice@example.com' });
      }, 100);
    }),
    (e) => new DatabaseError('SELECT', e instanceof Error ? e.message : String(e))
  );
}

function fetchExternalProfile(userId: string): ResultAsync<ExternalProfile, NetworkError> {
  return ResultAsync.fromPromise(
    new Promise<ExternalProfile>((resolve, reject) => {
      setTimeout(() => {
        if (userId === 'api-error') reject({ status: 503, message: 'Service unavailable' });
        else resolve({ avatarUrl: `https://example.com/avatar/${userId}`, bio: 'Hello world!' });
      }, 100);
    }),
    (e: any) => new NetworkError(`https://api.example.com/profiles/${userId}`, e.status, e.message || String(e))
  );
}

// ============================================================================
// Service functions
// ============================================================================

function getUser(id: string): ResultAsync<User, NotFoundError | DatabaseError> {
  return fetchUserFromDb(id).mapErr((dbError) => {
    if (dbError.message.includes('No rows')) return new NotFoundError('User', id, dbError);
    return dbError;
  });
}

// Graceful degradation - return user without profile if fetch fails
function getEnrichedUser(id: string): ResultAsync<EnrichedUser, NotFoundError | DatabaseError> {
  return getUser(id).andThen((user) =>
    fetchExternalProfile(id)
      .map((profile) => ({ ...user, profile }))
      .orElse(() => ok({ ...user }))
  );
}

// Strict - fail if profile fetch fails
function getEnrichedUserStrict(id: string): ResultAsync<EnrichedUser, AppError> {
  return getUser(id).andThen((user) =>
    fetchExternalProfile(id)
      .map((profile): EnrichedUser => ({ ...user, profile }))
      .mapErr((e) => e.wrap(`Failed to fetch profile for user ${id}`))
  );
}

function processUser(id: string): ResultAsync<string, AppError> {
  return getUser(id)
    .andThen((user) => fetchExternalProfile(id).map((profile) => `${user.name} - ${profile.bio}`))
    .mapErr((e) => e.wrap(`Failed to process user ${id}`));
}

// ============================================================================
// Demo
// ============================================================================

async function main() {
  console.log('=== Async Operations Example ===\n');

  console.log('1. Basic user fetch:');
  const user1 = await getUser('user-1');
  user1.match(
    (u) => console.log(`  Found: ${u.name} <${u.email}>`),
    (e) => console.log(`  Error: ${e.chain()}`),
  );

  console.log('\n2. User not found:');
  const user2 = await getUser('not-found');
  user2.match(
    (u) => console.log(`  Found: ${u.name}`),
    (e) => {
      console.log(`  Error chain: ${e.chain()}`);
      const nf = asError(e, NotFoundError);
      if (nf) {
        console.log(`  Resource: ${nf.resource}, ID: ${nf.id}`);
      }
    },
  );

  console.log('\n3. Database error:');
  const user3 = await getUser('db-error');
  user3.match(
    (u) => console.log(`  Found: ${u.name}`),
    (e) => {
      console.log(`  Error: ${e.message}`);
      const db = asError(e, DatabaseError);
      if (db) console.log(`  Operation: ${db.operation}`);
    },
  );

  console.log('\n4. Enriched user (graceful - profile fetch fails):');
  const enriched1 = await getEnrichedUser('api-error');
  enriched1.match(
    (u) => console.log(`  User: ${u.name}, Profile: ${u.profile ? 'loaded' : 'not available'}`),
    (e) => console.log(`  Error: ${e.chain()}`),
  );

  console.log('\n5. Enriched user (strict - profile required):');
  const enriched2 = await getEnrichedUserStrict('api-error');
  enriched2.match(
    (u) => console.log(`  User: ${u.name}, Bio: ${u.profile?.bio}`),
    (e) => {
      console.log(`  Error chain: ${e.chain()}`);
      const ne = asError(e, NetworkError);
      if (ne) {
        console.log(`  URL: ${ne.url}, Status: ${ne.statusCode}`);
      }
    },
  );

  console.log('\n6. Successful enriched user:');
  const enriched3 = await getEnrichedUserStrict('user-1');
  enriched3.match(
    (u) => console.log(`  User: ${u.name}, Bio: ${u.profile?.bio}`),
    (e) => console.log(`  Error: ${e.chain()}`),
  );

  console.log('\n7. tryCatchAsync for unsafe operations:');
  const risky = await tryCatchAsync(async () => { throw new Error('Exploded!'); });
  risky.match(
    (v) => console.log(`  Result: ${v}`),
    (e) => console.log(`  Caught: [${e.name}] ${e.message}`),
  );

  console.log('\n8. Processing user with context:');
  const processed = await processUser('user-1');
  processed.match(
    (v) => console.log(`  Result: ${v}`),
    (e) => console.log(`  Error: ${e.chain()}`),
  );

  console.log('\n9. Full stack trace on error:');
  const failed = await processUser('api-error');
  failed.match(
    () => {},
    (e) => console.log(e.fullStack().split('\n').map(l => '  ' + l).join('\n')),
  );
}

main().catch(console.error);

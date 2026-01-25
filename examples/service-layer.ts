/**
 * Service layer example showing real-world usage with typed errors.
 */
import {
  ok,
  err,
  Result,
  AppError,
  NotFoundError,
  ValidationError,
  DatabaseError,
  PermissionError,
  createErrorClass,
} from '../src/index.ts';

// ============================================================================
// Domain types
// ============================================================================

type UserId = string;
type OrderId = string;

interface User {
  id: UserId;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

interface Order {
  id: OrderId;
  userId: UserId;
  items: { productId: string; quantity: number }[];
  total: number;
  status: 'pending' | 'confirmed' | 'shipped';
}

// ============================================================================
// Custom domain errors
// ============================================================================

class InsufficientStockError extends AppError {
  constructor(
    public readonly productId: string,
    public readonly requested: number,
    public readonly available: number,
    cause?: AppError
  ) {
    super(`Product ${productId}: requested ${requested}, available ${available}`, cause);
  }
}

class PaymentFailedError extends AppError {
  constructor(
    public readonly reason: string,
    public readonly code: string,
    cause?: AppError
  ) {
    super(`Payment failed: ${reason} (${code})`, cause);
  }
}

const RateLimitError = createErrorClass('RateLimitError', (props: { endpoint: string; retryAfter: number }) =>
  `Rate limited on ${props.endpoint}. Retry after ${props.retryAfter}s`
);

// ============================================================================
// Repository layer
// ============================================================================

const userRepository = {
  findById(id: UserId): Result<User, DatabaseError> {
    if (id === 'db-fail') {
      return err(new DatabaseError('SELECT', 'Connection pool exhausted'));
    }
    if (id === 'user-1') {
      return ok({ id, name: 'Alice', email: 'alice@example.com', role: 'admin' });
    }
    if (id === 'user-2') {
      return ok({ id, name: 'Bob', email: 'bob@example.com', role: 'user' });
    }
    return err(new DatabaseError('SELECT', 'No rows returned'));
  },
};

const orderRepository = {
  findById(id: OrderId): Result<Order, DatabaseError> {
    if (id === 'order-1') {
      return ok({
        id,
        userId: 'user-2',
        items: [{ productId: 'prod-1', quantity: 2 }],
        total: 99.99,
        status: 'pending',
      });
    }
    return err(new DatabaseError('SELECT', 'Order not found'));
  },

  save(order: Order): Result<Order, DatabaseError> {
    return ok(order);
  },
};

// ============================================================================
// Service layer
// ============================================================================

const userService = {
  getUser(id: UserId): Result<User, NotFoundError | DatabaseError> {
    return userRepository.findById(id).mapErr((dbError) => {
      if (dbError.message.includes('No rows')) {
        return new NotFoundError('User', id, dbError);
      }
      return dbError;
    });
  },

  validateUserCanModifyOrder(user: User, order: Order): Result<void, PermissionError> {
    if (user.role === 'admin') return ok(undefined);
    if (order.userId !== user.id) {
      return err(new PermissionError('modify', `order ${order.id}`));
    }
    return ok(undefined);
  },
};

// Error types for order service - just use AppError for wrapped errors
type CancelOrderError =
  | NotFoundError
  | DatabaseError
  | PermissionError
  | ValidationError
  | AppError;

const orderService = {
  getOrder(id: OrderId): Result<Order, NotFoundError | DatabaseError> {
    return orderRepository.findById(id).mapErr((dbError) => {
      if (dbError.message.includes('not found')) {
        return new NotFoundError('Order', id, dbError);
      }
      return dbError;
    });
  },

  cancelOrder(orderId: OrderId, userId: UserId): Result<Order, CancelOrderError> {
    const userResult = userService.getUser(userId);
    if (userResult.isErr()) {
      return err(userResult.error.wrap(`Failed to get user ${userId}`));
    }
    const user = userResult.value;

    const orderResult = this.getOrder(orderId);
    if (orderResult.isErr()) {
      return err(orderResult.error.wrap(`Failed to get order ${orderId}`));
    }
    const order = orderResult.value;

    const permResult = userService.validateUserCanModifyOrder(user, order);
    if (permResult.isErr()) {
      return err(permResult.error);
    }

    if (order.status === 'shipped') {
      return err(new ValidationError('status', 'Cannot cancel shipped orders'));
    }

    return orderRepository.save({ ...order, status: 'pending' });
  },
};

// ============================================================================
// API/Controller layer
// ============================================================================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

function handleCancelOrder(orderId: string, userId: string): ApiResponse<Order> {
  const result = orderService.cancelOrder(orderId, userId);

  return result.match(
    (order) => ({ success: true, data: order }),
    (error) => {
      console.error('Cancel order failed:', error.fullStack());

      if (error.is(NotFoundError)) {
        const nf = error.as(NotFoundError)!;
        return { success: false, error: { code: 'NOT_FOUND', message: `${nf.resource} not found`, details: { id: nf.id } } };
      }
      if (error.is(PermissionError)) {
        return { success: false, error: { code: 'FORBIDDEN', message: error.as(PermissionError)!.message } };
      }
      if (error.is(ValidationError)) {
        const v = error.as(ValidationError)!;
        return { success: false, error: { code: 'VALIDATION_ERROR', message: v.message, details: { field: v.field } } };
      }
      if (error.is(DatabaseError)) {
        return { success: false, error: { code: 'INTERNAL_ERROR', message: 'A database error occurred' } };
      }
      return { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } };
    },
  );
}

// ============================================================================
// Test scenarios
// ============================================================================

console.log('=== Service Layer Example ===\n');

console.log('1. Admin cancels order:');
console.log(JSON.stringify(handleCancelOrder('order-1', 'user-1'), null, 2));

console.log('\n2. Owner cancels own order:');
console.log(JSON.stringify(handleCancelOrder('order-1', 'user-2'), null, 2));

console.log('\n3. Order not found:');
console.log(JSON.stringify(handleCancelOrder('order-999', 'user-1'), null, 2));

console.log('\n4. User not found:');
console.log(JSON.stringify(handleCancelOrder('order-1', 'user-999'), null, 2));

console.log('\n5. Database failure:');
console.log(JSON.stringify(handleCancelOrder('order-1', 'db-fail'), null, 2));

// Custom errors
console.log('\n=== Custom Domain Errors ===\n');

const paymentResult = err(new PaymentFailedError('Card declined', 'CARD_DECLINED'));
paymentResult.match(
  () => console.log('Payment successful'),
  (e) => console.log(`Payment error: ${e.reason} (code: ${e.code}), tag: ${e.tag}`),
);

const stockResult = err(new InsufficientStockError('prod-123', 5, 2));
stockResult.match(
  () => console.log('Stock OK'),
  (e) => console.log(`Stock error: need ${e.requested}, have ${e.available}, tag: ${e.tag}`),
);

const rateLimitResult = err(new RateLimitError({ endpoint: '/api/orders', retryAfter: 60 }));
rateLimitResult.match(
  () => {},
  (e) => console.log(`Rate limit: ${e.message}, tag: ${e.tag}`),
);

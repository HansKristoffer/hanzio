# typedswitch

A type-safe, exhaustive switch expression for TypeScript. Handle discriminated unions and string literals with full type inference, compile-time exhaustiveness checking, and async support.

## Installation

```bash
npm install typedswitch
```

```bash
pnpm add typedswitch
```

```bash
bun add typedswitch
```

## Features

- **Full type inference** — Return types are automatically inferred from your handlers
- **Exhaustiveness checking** — TypeScript ensures all cases are handled at compile time
- **Discriminated union support** — Works with any discriminant key, not just `type`
- **Async-aware** — Async handlers preserve their `Promise` return type
- **Default handlers** — Handle remaining cases with a fallback
- **Return type constraints** — Enforce that all handlers return a specific type

## Usage

### String/Enum Input

Switch on a string literal or enum value directly:

```typescript
import { typedSwitch } from 'typedswitch'

type Status = 'success' | 'error' | 'pending'

const status: Status = 'success'

// All cases required — TypeScript enforces exhaustiveness
const message = typedSwitch(status, {
  success: () => 'Operation completed!',
  error: () => 'Something went wrong',
  pending: () => 'Please wait...',
})
// message: string
```

Each handler receives the narrowed value:

```typescript
const result = typedSwitch(status, {
  success: (val) => val.toUpperCase(), // val: 'success'
  error: (val) => val.toUpperCase(),   // val: 'error'
  pending: (val) => val.toUpperCase(), // val: 'pending'
})
```

### Discriminated Union Input

Switch on objects with a string-valued discriminant property (like `type`, `kind`, `status`, etc.):

```typescript
type Event =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; offset: number }
  | { type: 'keypress'; key: string }

const event: Event = { type: 'click', x: 100, y: 200 }

// Specify the discriminant key as the second argument
const description = typedSwitch(event, 'type', {
  click: (e) => `Clicked at (${e.x}, ${e.y})`,   // e: { type: 'click'; x: number; y: number }
  scroll: (e) => `Scrolled ${e.offset}px`,       // e: { type: 'scroll'; offset: number }
  keypress: (e) => `Pressed ${e.key}`,           // e: { type: 'keypress'; key: string }
})
// description: string
```

Works with any discriminant key:

```typescript
type Order =
  | { status: 'pending'; createdAt: Date }
  | { status: 'completed'; completedAt: Date }
  | { status: 'cancelled'; reason: string }

const order: Order = { status: 'completed', completedAt: new Date() }

const info = typedSwitch(order, 'status', {
  pending: (o) => `Created: ${o.createdAt}`,
  completed: (o) => `Done: ${o.completedAt}`,
  cancelled: (o) => `Cancelled: ${o.reason}`,
})
```

### Default Handler

Handle a subset of cases and catch the rest with a default handler:

```typescript
type Status = 'success' | 'error' | 'pending' | 'cancelled'

const status: Status = 'cancelled'

// Only handle specific cases, default handles the rest
const message = typedSwitch(
  status,
  {
    success: () => 'Done!',
    error: () => 'Failed!',
  },
  (val) => `Unhandled status: ${val}`  // val: Status (full union)
)
// message: string
```

Works with discriminated unions too:

```typescript
const description = typedSwitch(
  event,
  'type',
  {
    click: (e) => `Clicked at (${e.x}, ${e.y})`,
  },
  (e) => `Unhandled event: ${e.type}`  // e: Event (full union)
)
```

### Async Handlers

Mix sync and async handlers freely. `typedSwitch` returns the selected handler's value directly, so async branches preserve their `Promise` return type while sync branches remain sync:

```typescript
// All sync — returns string
const syncResult = typedSwitch(status, {
  success: () => 'ok',
  error: () => 'err',
  pending: () => 'wait',
})
// syncResult: string

// All async — returns Promise<string>
const asyncResult = typedSwitch(status, {
  success: async () => {
    const data = await fetchData()
    return data.message
  },
  error: async () => 'err',
  pending: async () => 'wait',
})
// asyncResult: Promise<string>

const message = await asyncResult

// Mixed sync/async — returns string | Promise<string>
const mixedResult = typedSwitch(status, {
  success: () => 'ok',
  error: async () => 'err',
  pending: () => 'wait',
})
```

### Return Type Inference

Return types are inferred from all handlers as a union:

```typescript
const result = typedSwitch(status, {
  success: () => ({ ok: true, data: 'hello' }),
  error: () => ({ ok: false, code: 500 }),
  pending: () => null,
})
// result: { ok: true; data: string } | { ok: false; code: number } | null
```

### Return Type Constraints

Enforce that all handlers return a type extending a constraint with `typedSwitch<Constraint>(...)`. The `<Constraint>` is optional; omit it when you want TypeScript to infer the return types freely.

```typescript
interface HasId {
  id: string
}

// All handlers must return something with { id: string }
const result = typedSwitch<HasId>(status, {
  success: () => ({ id: '123', name: 'John' }),     // ✓ OK
  error: () => ({ id: '456', code: 500 }),          // ✓ OK
  pending: () => ({ id: '789' }),                   // ✓ OK
})
// result: HasId

// This would be a compile error:
typedSwitch<HasId>(status, {
  success: () => ({ name: 'John' }),  // ✗ Error: missing 'id'
  error: () => ({ id: '456' }),
  pending: () => ({ id: '789' }),
})
```

Constraints also work with discriminated unions and default handlers:

```typescript
const result = typedSwitch<HasId>(
  event,
  'type',
  {
    click: () => ({ id: 'click-1', x: 10, y: 20 }),
    scroll: () => ({ id: 'scroll-1', offset: 100 }),
    keypress: () => ({ id: 'key-1', key: 'Enter' }),
  }
)
```

## Error Handling

When a case is unhandled at runtime (e.g., due to unsafe casts), `typedSwitch` throws a descriptive error:

```typescript
const status = 'unknown' as Status

typedSwitch(status, {
  success: () => 'ok',
  error: () => 'err',
})
// Throws: "Unhandled case: unknown. Available cases: success, error"
```

For discriminated unions:

```typescript
// Throws: "Unhandled case: unknown (discriminant key: "type"). Available cases: click, scroll, keypress"
```

Object discriminants must be strings. Missing or non-string discriminant values throw a runtime error if they reach `typedSwitch`.

## API Reference

### `typedSwitch(value, cases)`

Switch on a string literal with exhaustive case handling.

### `typedSwitch(value, cases, defaultHandler)`

Switch on a string literal with partial cases and a default fallback.

### `typedSwitch(object, key, cases)`

Switch on a discriminated union using the specified discriminant key.

### `typedSwitch(object, key, cases, defaultHandler)`

Switch on a discriminated union with partial cases and a default fallback.

### `typedSwitch<Constraint>(value, cases)`

Switch on a string literal while enforcing that each handler returns `Constraint` or `Promise<Constraint>`.

### `typedSwitch<Constraint>(object, key, cases)`

Switch on a discriminated union while enforcing that each handler returns `Constraint` or `Promise<Constraint>`.

### Exported Helper Types

`StringSwitchCases`, `PartialStringSwitchCases`, `ObjectSwitchCases`, and `PartialObjectSwitchCases` are exported for users who want to annotate reusable case maps.

## License

MIT

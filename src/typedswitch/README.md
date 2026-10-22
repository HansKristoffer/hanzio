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
- **Grouped cases** — Share one handler between several values, fully typed
- **Default handlers** — Handle remaining cases with a fallback
- **Nullable values** — `null` and `undefined` are cases like any other
- **Typo-proof cases** — A case key that isn't a value of the union is a compile error
- **`assertNever`** — Exhaustiveness checking for regular `switch` statements

## Usage

### Plain Value Input

Switch on a string, number, boolean or enum value directly:

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

Numbers and booleans are keyed by `String(value)`, and each handler still
receives the typed value:

```typescript
typedSwitch(code, {
  200: (c) => 'ok',            // c: 200
  404: (c) => `missing ${c}`,  // c: 404
})

typedSwitch(enabled, {
  true: () => 'on',
  false: () => 'off',
})
```

### Discriminated Union Input

Switch on objects with a string, number, or boolean discriminant property (like `type`, `kind`, `status`, etc.):

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

Number and boolean discriminants work too. Cases are keyed by `String(value)`:

```typescript
type Response =
  | { code: 200; body: string }
  | { code: 404; path: string }

typedSwitch(response, 'code', {
  200: (r) => r.body,              // r: { code: 200; body: string }
  404: (r) => `Missing ${r.path}`, // r: { code: 404; path: string }
})

type Result = { ok: true; value: number } | { ok: false; error: string }

typedSwitch(result, 'ok', {
  true: (r) => r.value,
  false: (r) => r.error,
})
```

### Grouped Cases

Spread `typedSwitchGroup` into the cases to share one handler between several
values. Pass the switched value (and key) so the types are inferred. The
handler receives the union of the grouped members, and exhaustiveness checking,
default handlers and return type inference keep working:

```typescript
import { typedSwitch, typedSwitchGroup } from 'typedswitch'

const description = typedSwitch(event, 'type', {
  ...typedSwitchGroup(event, 'type', ['click', 'scroll'], (e) => e.type), // e: click or scroll event
  keypress: (e) => `Pressed ${e.key}`,
})

const message = typedSwitch(status, {
  ...typedSwitchGroup(status, ['error', 'cancelled'], (s) => `Stopped: ${s}`), // s: 'error' | 'cancelled'
  success: () => 'Done!',
  pending: () => 'Please wait...',
})
```

Group keys must be values of the discriminant. A case written after the spread
replaces the grouped handler for that key; writing it before the spread is a
type error. If two groups list the same key, the later group wins.

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
  (val) => `Unhandled status: ${val}`  // val: 'pending' | 'cancelled' (unhandled cases only)
)
// message: string
```

Only required, defined handlers narrow the default handler's input. Optional
handlers (including reusable `PartialStringSwitchCases` and
`PartialObjectSwitchCases` maps) can be absent, so their cases remain in the
default handler's input type.

Works with discriminated unions too:

```typescript
const description = typedSwitch(
  event,
  'type',
  {
    click: (e) => `Clicked at (${e.x}, ${e.y})`,
  },
  (e) => `Unhandled event: ${e.type}`  // e: scroll or keypress event (unhandled members only)
)
```

### Values That Can Be Null or Undefined

When the value can be `null` or `undefined`, handle it with a `null` or
`undefined` case. These are required like any other case, unless a default
handler catches them:

```typescript
const status: 'success' | 'error' | null = row.status

const label = typedSwitch(status, {
  success: () => 'Done!',
  error: () => 'Failed!',
  null: () => 'Not started',
})

// Same for an object that can be null or undefined
typedSwitch(maybeEvent, 'type', {
  click: (e) => e.x,
  scroll: (e) => e.offset,
  keypress: (e) => 0,
  undefined: () => -1,
})
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

### Enforcing a Return Type

Annotate the result, or switch in a function with a declared return type.
Every handler is checked against it, exhaustiveness checking still applies,
and literals keep their types instead of widening to `string`:

```typescript
type Severity = 'success' | 'info' | 'warn' | 'danger'

const severity: Severity = typedSwitch(quality, {
  excellent: () => 'success',
  good: () => 'info',
  fair: () => 'warn',
  poor: () => 'danger',
})

function orderBy(sort: Sort): Prisma.OrderOrderByWithRelationInput[] {
  return typedSwitch(sort, {
    name: () => [{ name: 'asc' }],
    newest: () => [{ createdAt: 'desc' }],
  })
}
```

Without an annotation, or inside a generic call such as `useState(typedSwitch(...))`,
the result is the union of the handlers' widened return types. In Vue, annotate
the getter: `computed((): Severity => typedSwitch(...))`.

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

Object discriminants must be strings, numbers, or booleans. Missing or other discriminant values throw a runtime error if they reach `typedSwitch`.

## `assertNever`

For regular `switch` statements, put `assertNever` in the `default` branch. It fails to compile if a case is missing, and throws at runtime if an unexpected value gets through:

```typescript
import { assertNever } from 'typedswitch'

function label(status: Status) {
  switch (status) {
    case 'success': return 'Done'
    case 'error': return 'Failed'
    case 'pending': return 'Waiting'
    default: return assertNever(status) // compile error if a case is missing
  }
}
```

## API Reference

### `typedSwitch(value, cases)`

Switch on a string, number or boolean value with exhaustive case handling.

### `typedSwitch(value, cases, defaultHandler)`

Switch on a string, number or boolean value with partial cases and a default fallback.

### `typedSwitch(object, key, cases)`

Switch on a discriminated union using the specified discriminant key (string, number, or boolean values).

### `typedSwitch(object, key, cases, defaultHandler)`

Switch on a discriminated union with partial cases and a default fallback.

### `typedSwitchGroup(value, keys, handler)` / `typedSwitchGroup(object, key, keys, handler)`

Returns cases that all call `handler`, for spreading into `typedSwitch` cases.

### `assertNever(value, message?)`

Takes a `never` value and always throws (`Unexpected value: ${value}` or `message`). Use it for exhaustive `switch` statements.

### Exported Helper Types

`StringSwitchCases`, `PartialStringSwitchCases`, `ObjectSwitchCases`, and `PartialObjectSwitchCases` are exported for users who want to annotate reusable case maps.

## License

MIT

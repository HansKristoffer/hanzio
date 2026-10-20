---
description: SSE keep-alive comments and anti-buffering headers for streaming responses.
---

# hanzio/http

Web-standard (`Response`, `TransformStream`), so it runs in Bun, Node and
Workers.

```ts
import { withSseKeepAlive } from 'hanzio/http'

return withSseKeepAlive(createUIMessageStreamResponse({ stream }))
```

`withSseKeepAlive(response, intervalMs = 15_000)` returns a copy of the
response whose body writes an SSE comment (`:\n\n`) right away and again after
every `intervalMs` without data, so proxy idle timers (Railway, nginx) don't
close a stream that goes quiet. It also sets `Cache-Control: no-cache`,
`X-Accel-Buffering: no` and `Connection: keep-alive`.

`createSseKeepAliveTransform(intervalMs, timers?)` is the transform on its own,
for a stream you pipe yourself; `timers` takes fake `setTimeout` /
`clearTimeout` functions in tests. `SSE_KEEPALIVE_COMMENT` is the comment's
bytes.

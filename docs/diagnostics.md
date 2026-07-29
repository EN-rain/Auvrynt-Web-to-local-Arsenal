# Diagnostics Endpoints

Auvrynt exposes two unauthenticated diagnostic HTTP endpoints for health monitoring. Detailed process and resource information is returned only to loopback clients. Requests arriving through a trusted local tunnel proxy receive minimal responses so public health checks do not disclose internal state.

Both endpoints send `Cache-Control: no-store`.

## /healthz

Simple liveness check with no database or external I/O.

### Public response (200 OK)

```json
{
  "ok": true
}
```

### Loopback response (200 OK)

```json
{
  "ok": true,
  "name": "auvrynt",
  "pid": 12345,
  "uptimeSeconds": 3600
}
```

## /readyz

Readiness endpoint. It returns HTTP 503 while the server is shutting down or reconfiguring.

### Public response

```json
{
  "ready": true
}
```

The same minimal shape is returned with HTTP 503 and `ready: false` when unavailable.

### Loopback response (200 OK)

```json
{
  "ready": true,
  "sessions": 1,
  "sessionsByState": {
    "initializing": 0,
    "active": 1,
    "disconnected": 0,
    "closing": 0
  },
  "activeMcpRequests": 0,
  "activeToolCalls": 0,
  "runningProcesses": 0,
  "eventLoopDelay": 1,
  "memory": {
    "rss": 123456789,
    "heapTotal": 98765432,
    "heapUsed": 45678901
  },
  "integrationQueues": {}
}
```

The detailed loopback response may include additional bounded diagnostic fields as the server evolves.

### Usage

- Use `/healthz` for load-balancer and tunnel liveness checks.
- Use `/readyz` to decide whether new MCP work should be accepted.
- Inspect `/readyz` locally when diagnosing sessions, process load, memory, integration queues, or a 502 response.
- Long-running MCP SSE responses emit a comment heartbeat every 15 seconds so tunnels do not treat a silent build or render as abandoned.
- Oversized tool results are truncated or have inline binary omitted before transmission. Request a narrower file range, fewer results, or a smaller image when the response includes an Auvrynt truncation notice.
- Browser screenshots and Blender/image outputs are still saved locally when they are too large to embed safely.
- Do not expose another proxy layer that rewrites remote requests to appear as direct loopback traffic.

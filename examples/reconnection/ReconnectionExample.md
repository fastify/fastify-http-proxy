# Reconnection Example

This example demonstrates how to use the reconnection feature of the proxy.

It simulates an unstable target service: slow to start, unresponsive due to block of the event loop, crash and restart.

The goal is to ensures a more resilient and customizable integration, minimizing disruptions caused by connection instability.


## How to run

Run the unstable target

```
cd examples/reconnection/unstable-target
npm run unstable
```

Run the proxy

```
cd examples/reconnection/proxy
npm run start
```

Then run the client

```
cd examples/reconnection/client
npm run start
```

---

## How it works

### Proxy Connection Monitoring and Recovery

The proxy monitors the target connection using a ping/pong mechanism. If a pong response does not arrive on time, the connection is closed, and the proxy attempts to reconnect.

If the target service crashes, the connection may close either gracefully or abruptly. Regardless of how the disconnection occurs, the proxy detects the connection loss and initiates a reconnection attempt.

### Connection Stability

- The connection between the client and the proxy remains unaffected by an unstable target.
- The connection between the proxy and the target may be closed due to:
- The target failing to respond to ping messages, even if the connection is still technically open (e.g., due to a freeze or blockage).
- The target crashing and restarting.

### Handling Data Loss During Reconnection

The proxy supports hooks to manage potential data loss during reconnection. These hooks allow for custom logic to ensure message integrity when resending data from the client to the target.

Examples of how hooks can be used based on the target service type:

- GraphQL subscriptions: Resend the subscription from the last received message.
- Message brokers: Resend messages starting from the last successfully processed message.

In this example, the proxy re-sends the messages from the last ping to ensure all the messages are sent to the target, without any additional logic. 
Resending messages from the last pong ensures that the target does not miss any messages, but it may send messages more than once.

# @fastify/http-proxy

[![CI](https://github.com/fastify/fastify-http-proxy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fastify/fastify-http-proxy/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/@fastify/http-proxy.svg?style=flat)](https://www.npmjs.com/package/@fastify/http-proxy)
[![neostandard javascript style](https://img.shields.io/badge/code_style-neostandard-brightgreen?style=flat)](https://github.com/neostandard/neostandard)

Proxy your HTTP requests to another server, with hooks.
This [`fastify`](https://fastify.dev) plugin forwards all requests
received with a given prefix (or none) to an upstream. All Fastify hooks are still applied.

`@fastify/http-proxy` is built on top of
[`@fastify/reply-from`](https://npm.im/@fastify/reply-from), which enables single route proxying.

This plugin can be used in a variety of circumstances, for example, if you have to proxy an internal domain to an external domain (useful to avoid CORS problems) or to implement your own API gateway for a microservices architecture.

## Requirements

Fastify 5.x.
See [@fastify/http-proxy v9.x](https://github.com/fastify/fastify-http-proxy/tree/v9.x) for Fastify 4.x compatibility.

## Install

```
npm i @fastify/http-proxy fastify
```

## Example

```js
const Fastify = require('fastify');
const server = Fastify();

server.register(require('@fastify/http-proxy'), {
  upstream: 'http://my-api.example.com',
  prefix: '/api', // optional
  http2: false, // optional
});

server.listen({ port: 3000 });
```

This will proxy any request starting with `/api` to `http://my-api.example.com`. For instance, `http://localhost:3000/api/users` will be proxied to `http://my-api.example.com/users`.

If you want to have different proxies on different prefixes you can register multiple instances of the plugin as shown in the following snippet:

```js
const Fastify = require('fastify');
const server = Fastify();
const proxy = require('@fastify/http-proxy');

// /api/x will be proxied to http://my-api.example.com/x
server.register(proxy, {
  upstream: 'http://my-api.example.com',
  prefix: '/api', // optional
  http2: false, // optional
});

// /rest-api/123/endpoint will be proxied to http://my-rest-api.example.com/123/endpoint
server.register(proxy, {
  upstream: 'http://my-rest-api.example.com',
  prefix: '/rest-api/:id/endpoint', // optional
  rewritePrefix: '/:id/endpoint', // optional
  http2: false, // optional
});

// /auth/user will be proxied to http://single-signon.example.com/signon/user
server.register(proxy, {
  upstream: 'http://single-signon.example.com',
  prefix: '/auth', // optional
  rewritePrefix: '/signon', // optional
  http2: false, // optional
});

// /user will be proxied to http://single-signon.example.com/signon/user
server.register(proxy, {
  upstream: 'http://single-signon.example.com',
  rewritePrefix: '/signon', // optional
  http2: false, // optional
});

server.listen({ port: 3000 });
```

Notice that in this case, it is important to use the `prefix` option to tell the proxy how to properly route the requests across different upstreams.

Also, notice paths in `upstream` are ignored, so you need to use `rewritePrefix` to specify the target base path.

For other examples, see [`example.js`](examples/example.js).

## Request tracking

`@fastify/http-proxy` can track and pipe the `request-id` across the upstreams. Using the [`hyperid`](https://www.npmjs.com/package/hyperid) module and the [`@fastify/reply-from`](https://github.com/fastify/fastify-reply-from) built-in options a fairly simple example would look like this:

```js
const Fastify = require('fastify');
const proxy = require('@fastify/http-proxy');
const hyperid = require('hyperid');

const server = Fastify();
const uuid = hyperid();

server.register(proxy, {
  upstream: 'http://localhost:4001',
  replyOptions: {
    rewriteRequestHeaders: (originalReq, headers) => ({
      ...headers,
      'request-id': uuid(),
    }),
  },
});

server.listen({ port: 3000 });
```

## Options

This `fastify` plugin supports _all_ the options of
[`@fastify/reply-from`](https://github.com/fastify/fastify-reply-from) plus the following.

_Note that this plugin is fully encapsulated, and non-JSON payloads will
be streamed directly to the destination._

### `upstream`

An URL (including protocol) that represents the target server to use for proxying.

### `prefix`

The prefix to mount this plugin on. All the requests to the current server starting with the given prefix will be proxied to the provided upstream.

Parametric path is supported. To register a parametric path, use the colon before the parameter name.

The prefix will be removed from the URL when forwarding the HTTP
request.

### `rewritePrefix`

Rewrite the prefix to the specified string. Default: `''`.

### `preHandler`

A `preHandler` to be applied on all routes. Useful for performing actions before the proxy is executed (e.g. check for authentication).

### `proxyPayloads`

When this option is `false`, you will be able to access the body but it will also disable direct pass through of the payload. As a result, it is left up to the implementation to properly parse and proxy the payload correctly.

For example, if you are expecting a payload of type `application/xml`, then you would have to add a parser for it like so:

```javascript
fastify.addContentTypeParser('application/xml', (req, done) => {
  const parsedBody = parsingCode(req);
  done(null, parsedBody);
});
```

### `preValidation`

Specify preValidation function to perform the validation of the request before the proxy is executed (e.g. check request payload).

```javascript
fastify.register(proxy, {
  upstream: `http://your-target-upstream.com`,
  preValidation: async (request, reply) => {
    if (request.body.method === 'invalid_method') {
      return reply.code(400).send({ message: 'payload contains invalid method' });
    }
  },
});
```

### `config`

An object accessible within the `preHandler` via `reply.context.config`.
See [Config](https://fastify.dev/docs/latest/Reference/Routes/#config) in the Fastify
documentation for information on this option. Note: this is merged with other
configuration passed to the route.

### `replyOptions`

Object with [reply options](https://github.com/fastify/fastify-reply-from#replyfromsource-opts) for `@fastify/reply-from`.

### `internalRewriteLocationHeader`

By default, `@fastify/http-proxy` will rewrite the `location` header when a request redirects to a relative path.
In other words, the [prefix](https://github.com/fastify/fastify-http-proxy#prefix) will be added to the relative path.

If you want to preserve the original path, this option will disable this internal operation. Default: `true`.

Note that the [rewriteHeaders](https://github.com/fastify/fastify-reply-from#rewriteheadersheaders-request) option of [`@fastify/reply-from`](http://npm.im/fastify-reply-from) will retrieve headers modified (reminder: only `location` is updated among all headers) in parameter but with this option, the headers are unchanged.

### `httpMethods`

An array that contains the types of the methods. Default: `['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']`.

### `routes`

An array that contains the routes to handle. Default: `['/', '/*']`.

### `preRewrite`

A function that will be executed before rewriting the URL. It receives the URL, the request parameters and the prefix and must return the new URL. 

The function cannot return a promise.

### `websocket`

This module has _partial_ support for forwarding websockets by passing a
`websocket` boolean option.

A few things are missing:

1. request id logging
2. support `ignoreTrailingSlash`
3. forwarding more than one subprotocols. Note: Only the first subprotocol is being forwarded

Pull requests are welcome to finish this feature.

### `wsUpstream`

Working only if property `websocket` is `true`.

An URL (including protocol) that represents the target websockets to use for proxying websockets.
Accepted both `https://` and `wss://`.

Note that if property `wsUpstream` not specified then proxy will try to connect with the `upstream` property.

### `wsServerOptions`

The options passed to [`new ws.Server()`](https://github.com/websockets/ws/blob/HEAD/doc/ws.md#class-websocketserver).

### `wsClientOptions`

The options passed to the [`WebSocket` constructor](https://github.com/websockets/ws/blob/HEAD/doc/ws.md#class-websocket) for outgoing websockets.

It also supports an additional `rewriteRequestHeaders(headers, request)` function that can be used to write the headers before
opening the WebSocket connection. This function should return an object with the given headers.
The default implementation forwards the `cookie` header.

### `wsReconnect`

**Experimental.** (default: `disabled`)

Reconnection feature detects and closes broken connections and reconnects automatically, see [how to detect and close broken connections](https://github.com/websockets/ws#how-to-detect-and-close-broken-connections).
The connection is considered broken if the target does not respond to the ping messages or no data is received from the target.

The `wsReconnect` option contains the configuration for the WebSocket reconnection feature.
To enable the feature, set the `wsReconnect` option to an object with the following properties:

- `pingInterval`: The interval between ping messages in ms (default: `30_000`).
- `maxReconnectionRetries`: The maximum number of reconnection retries (`1` to `Infinity`, default: `Infinity`).
- `reconnectInterval`: The interval between reconnection attempts in ms (default: `1_000`).
- `reconnectDecay`: The decay factor for the reconnection interval (default: `1.5`).
- `connectionTimeout`: The timeout for establishing the connection in ms (default: `5_000`).
- `reconnectOnClose`: Whether to reconnect on close, as long as the connection from the related client to the proxy is active (default: `false`).
- `logs`: Whether to log the reconnection process (default: `false`).

See the example in [examples/reconnection](examples/reconnection).

### `wsHooks`

On websocket events, the following hooks are available, note **the hooks are all synchronous**.  
The `context` object is passed to all hooks and contains the `log` property.

- `onIncomingMessage`: A hook function that is called when the request is received from the client `onIncomingMessage(context, source, target, { data, binary })` (default: `undefined`).
- `onOutgoingMessage`: A hook function that is called when the response is received from the target `onOutgoingMessage(context, source, target, { data, binary })` (default: `undefined`).
- `onConnect`: A hook function that is called when the connection is established `onConnect(context, source, target)` (default: `undefined`).
- `onDisconnect`: A hook function that is called when the connection is closed `onDisconnect(context, source)` (default: `undefined`).
- `onReconnect`: A hook function that is called when the connection is reconnected `onReconnect(context, source, target)` (default: `undefined`). The function is called if reconnection feature is enabled.
- `onPong`: A hook function that is called when the target responds to the ping `onPong(context, source, target)` (default: `undefined`). The function is called if reconnection feature is enabled.

## Decorators

### `reply.fromParameters(url[, params[, prefix]])`

It can be used to get the final URL and options that `@fastify/http-proxy` would have used to invoke `reply.from`.

A typical use is to override the request URL:

```javascript
preHandler (request, reply, done) {
  if (request.url !== '/original') {
    done()
    return
  }

  const { url, options } = reply.fromParameters('/updated', { ...request.params, serverId: 42 })
  reply.from(url, options)
}
```

## Benchmarks

The following benchmarks were generated on a dedicated server with an Intel(R) Core(TM) i7-7700 CPU @ 3.60GHz and 64GB of RAM:

| **Framework**         | req/sec |
| :-------------------- | :------ |
| `express-http-proxy`  | 2557    |
| `http-proxy`          | 9519    |
| `@fastify/http-proxy` | 15919   |

The results were gathered on the second run of `autocannon -c 100 -d 5
URL`.

## TODO

- [ ] Perform validations for incoming data
- [ ] Finish implementing websocket

## License

Licensed under [MIT](./LICENSE).

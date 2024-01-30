# @fastify/http-proxy

![CI](https://github.com/fastify/fastify-http-proxy/workflows/CI/badge.svg)
[![NPM version](https://img.shields.io/npm/v/@fastify/http-proxy.svg?style=flat)](https://www.npmjs.com/package/@fastify/http-proxy)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://standardjs.com/)

Proxy your HTTP requests to another server, with hooks.
This [`fastify`](https://fastify.dev) plugin forwards all requests
received with a given prefix (or none) to an upstream. All Fastify hooks are still applied.

`@fastify/http-proxy` is built on top of
[`@fastify/reply-from`](https://npm.im/@fastify/reply-from), which enables single route proxying.

This plugin can be used in a variety of circumstances, for example if you have to proxy an internal domain to an external domain (useful to avoid CORS problems) or to implement your own API gateway for a microservices architecture.

## Requirements

Fastify 4.x.
See [@fastify/http-proxy v7.x](https://github.com/fastify/fastify-http-proxy/tree/v7.x) for Fastify 3.x compatibility.

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

This will proxy any request starting with `/api` to `http://my-api.example.com`. For instance `http://localhost:3000/api/users` will be proxied to `http://my-api.example.com/users`.

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

Notice that in this case it is important to use the `prefix` option to tell the proxy how to properly route the requests across different upstreams.

Also notice paths in `upstream` are ignored, so you need to use `rewritePrefix` to specify the target base path.

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
See [Config](https://fastify.dev/docs/v4.8.x/Reference/Routes/#config) in the Fastify
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

## Benchmarks

The following benchmarks where generated on a dedicated server with an Intel(R) Core(TM) i7-7700 CPU @ 3.60GHz and 64GB of RAM:

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

MIT

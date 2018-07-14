# fastify-http-proxy

[![Greenkeeper badge](https://badges.greenkeeper.io/fastify/fastify-http-proxy.svg)](https://greenkeeper.io/)

[![Build Status](https://travis-ci.org/fastify/fastify-http-proxy.svg?branch=master)](https://travis-ci.org/fastify/fastify-http-proxy)

Proxy your http requests to another server, with hooks.
This [`fastify`](https://www.fastify.io) plugin forward all the request
received with a given prefix (or none) to an upstream. All Fastify hooks are still applied.

`fastify-http-proxy` is built on top of
[`fastify-reply-from`](http://npm.im/fastify-reply-from), which enables
you for single route proxying.

This plugin can be used in a variety of circumstances, for example if you have to proxy an internal domain to an external domain (useful to avoid CORS problems) or to implement your own API gateway for a microservices architecture.

## Install

```
npm i fastify-http-proxy fastify
```

## Example

```js
const Fastify = require('fastify')
const server = Fastify()

server.register(require('fastify-http-proxy'), {
  'http://my-api.example.com',
  prefix: '/api', // optional
  http2: false // optional
})

server.listen(3000)
```

This will proxy any request starting with `/api` to `http://my-api.example.com`. For instance `http://localhost:3000/api/users` will be proxied to `http://my-api.example.com/users`.

If you want to have different proxies on different prefixes in you can register multiple instances of the plugin as shown in the following snippet:

```js
const Fastify = require('fastify')
const server = Fastify()
const proxy = require('fastify-http-proxy')

server.register(proxy, {
  'http://my-api.example.com',
  prefix: '/api', // optional
  http2: false // optional
})

server.register(proxy, {
  'http://single-signon.example.com/auth',
  prefix: '/auth', // optional
  http2: false // optional
})

server.listen(3000)
```

For other examples, see `example.js`.

## Options

This `fastify` plugin supports the following options.

*Note that this plugin is fully encapsulated, and non-JSON payloads will
be streamed directly to the destination.*

### upstream

An URL (including protocol) that represents the target server to use for proxying.

### prefix

The prefix to mount this plugin on. All the requests to the current server starting with the given prefix will be proxied to the provided upstream.

### beforeHandler

A `beforeHandler` to be applied on all routes. Useful for performing actions before the proxy is executed (e.g. check for authentication).

### http2

A boolean value that indicates whether the proxy should support http2.

## Benchmarks

The following benchmarks where generated on a Macbook 2018 with i5 and
8GB of RAM:

| __Framework__ | req/sec |
| `express-http-proxy` | 878.4 |
| `http-proxy` | 3837 |
| `fastify-http-proxy` | 4205 |

The results where gathered on the second run of `autocannon -c 100 -d 5
URL`.

## TODO

* [ ] Generate unique request ids and implement request tracking
* [ ] Perform validations for incoming data

## License

MIT

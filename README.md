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

## Requirements

Fastify 2.x. See [this branch](https://github.com/fastify/fastify-http-proxy/tree/1.x) and related versions for Fastify 1.x compatibility.

## Install

```
npm i fastify-http-proxy fastify
```

## Example

```js
const Fastify = require('fastify')
const server = Fastify()

server.register(require('fastify-http-proxy'), {
  upstream: 'http://my-api.example.com',
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
  upstream: 'http://my-api.example.com',
  prefix: '/api', // optional
  http2: false // optional
})

server.register(proxy, {
  upstream: 'http://single-signon.example.com/auth',
  prefix: '/auth', // optional
  http2: false // optional
})

server.listen(3000)
```

Notice that in this case it is important to use the `prefix` option to tell the proxy how to properly route the requests across different upstreams.

For other examples, see `example.js`.

## Options

This `fastify` plugin supports _all_ the options of
[`fastify-reply-from`](https://github.com/fastify/fastify-reply-from) plus the following.

*Note that this plugin is fully encapsulated, and non-JSON payloads will
be streamed directly to the destination.*

### upstream

An URL (including protocol) that represents the target server to use for proxying.

### prefix

The prefix to mount this plugin on. All the requests to the current server starting with the given prefix will be proxied to the provided upstream.

The prefix will be removed from the URL when forwarding the HTTP
request.

### rewritePrefix

Rewrite the prefix to the specified string. Default: `''`.

### preHandler

A `preHandler` to be applied on all routes. Useful for performing actions before the proxy is executed (e.g. check for authentication).

### replyOptions

Object with [reply options](https://github.com/fastify/fastify-reply-from#replyfromsource-opts) for `fastify-reply-from`.

## Benchmarks

The following benchmarks where generated on a Macbook 2018 with i5 and
8GB of RAM:

| __Framework__ | req/sec |
| :----------------- | :------------------------- |
| `express-http-proxy` | 878.4 |
| `http-proxy` | 3837 |
| `fastify-http-proxy` | 4205 |
| `fastify-http-proxy` (with [`undici`](https://github.com/mcollina/undici)) | 6235.6 |

The results where gathered on the second run of `autocannon -c 100 -d 5
URL`.

## TODO

* [ ] Generate unique request ids and implement request tracking
* [ ] Perform validations for incoming data

## License

MIT

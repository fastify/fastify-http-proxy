# fastify-http-proxy

Proxy your http requests to another server, with hooks.
This [`fastify`](https://www.fastify.io) plugin forward all the request
received with a given prefix (or none) to an upstream. All Fastify hooks are still applied.

`fastify-http-proxy` is built on top of
[`fastify-reply-from`](http://npm.im/fastify-reply-from), which enables
you for single route proxying.

## Install

```
npm i fastify-http-proxy fastify
```

## Example

```js
const Fastify = require('fastify')
const server = Fastify()

server.register(proxy, {
  upstream,
  prefix: '/upstream' // optional
})

server.listen(3000)
```

For a more complete example, see `example.js`.

## Options

This `fastify` plugin supports the following options.
Note that this plugin is fully encapsulated, and non-JSON payloads will
be streamed directly to the destination.

### upstream

The target server to use for proxying

### prefix

The prefix to mount this plugin on. This is provided by fastify itself.

### beforeHandler

A `beforeHandler` to be applied on all routes. Useful for performing
authentication.

## TODO

* [ ] Generate unique request ids and implement request tracking
* [ ] Perform validations for incoming data

## License

MIT

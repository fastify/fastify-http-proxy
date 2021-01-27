'use strict'

const From = require('fastify-reply-from')
const WebSocket = require('ws')

const httpMethods = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']

function liftErrorCode (code) {
  if (typeof code !== 'number') {
    // Sometimes "close" event emits with a non-numeric value
    return 1011
  } else if (code === 1004 || code === 1005 || code === 1006) {
    // ws module forbid those error codes usage, lift to "application level" (4xxx)
    return 4000 + (code % 1000)
  } else {
    return code
  }
}

function closeWebSocket (socket, code, reason) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(liftErrorCode(code), reason)
  }
}

function waitConnection (socket, write) {
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.once('open', write)
  } else {
    write()
  }
}

function proxyWebSockets (source, target) {
  function close (code, reason) {
    closeWebSocket(source, code, reason)
    closeWebSocket(target, code, reason)
  }

  source.on('message', data => waitConnection(target, () => target.send(data)))
  source.on('ping', data => waitConnection(target, () => target.ping(data)))
  source.on('pong', data => waitConnection(target, () => target.pong(data)))
  source.on('close', close)
  source.on('error', error => close(1011, error.message))
  source.on('unexpected-response', () => close(1011, 'unexpected response'))

  // source WebSocket is already connected because it is created by ws server
  target.on('message', data => source.send(data))
  target.on('ping', data => source.ping(data))
  target.on('pong', data => source.pong(data))
  target.on('close', close)
  target.on('error', error => close(1011, error.message))
  target.on('unexpected-response', () => close(1011, 'unexpected response'))
}

function createWebSocketUrl (options, request) {
  const source = new URL(request.url, 'http://127.0.0.1')

  const target = new URL(
    options.rewritePrefix || options.prefix || source.pathname,
    options.upstream
  )

  target.search = source.search

  return target
}

function setupWebSocketProxy (fastify, options) {
  const server = new WebSocket.Server({
    path: options.prefix,
    server: fastify.server,
    ...options.wsServerOptions
  })

  fastify.addHook('onClose', (instance, done) => server.close(done))

  // To be able to close the HTTP server,
  // all WebSocket clients need to be disconnected.
  // Fastify is missing a pre-close event, or the ability to
  // add a hook before the server.close call. We need to resort
  // to monkeypatching for now.
  const oldClose = fastify.server.close
  fastify.server.close = function (done) {
    for (const client of server.clients) {
      client.close()
    }
    oldClose.call(this, done)
  }

  server.on('error', (err) => {
    fastify.log.error(err)
  })

  server.on('connection', (source, request) => {
    const url = createWebSocketUrl(options, request)

    const target = new WebSocket(url, options.wsClientOptions)

    fastify.log.debug({ url: url.href }, 'proxy websocket')
    proxyWebSockets(source, target)
  })
}

async function httpProxy (fastify, opts) {
  if (!opts.upstream) {
    throw new Error('upstream must be specified')
  }

  const preHandler = opts.preHandler || opts.beforeHandler
  const rewritePrefix = opts.rewritePrefix || ''

  const fromOpts = Object.assign({}, opts)
  fromOpts.base = opts.upstream
  fromOpts.prefix = undefined

  const oldRewriteHeaders = (opts.replyOptions || {}).rewriteHeaders
  const replyOpts = Object.assign({}, opts.replyOptions, {
    rewriteHeaders
  })
  fromOpts.rewriteHeaders = rewriteHeaders

  fastify.register(From, fromOpts)

  if (opts.proxyPayloads !== false) {
    fastify.addContentTypeParser('application/json', bodyParser)
    fastify.addContentTypeParser('*', bodyParser)
  }

  function rewriteHeaders (headers) {
    const location = headers.location
    if (location) {
      headers.location = location.replace(rewritePrefix, fastify.prefix)
    }
    if (oldRewriteHeaders) {
      headers = oldRewriteHeaders(headers)
    }
    return headers
  }

  function bodyParser (req, payload, done) {
    done(null, payload)
  }

  fastify.route({
    url: '/',
    method: httpMethods,
    preHandler,
    config: opts.config || {},
    handler
  })
  fastify.route({
    url: '/*',
    method: httpMethods,
    preHandler,
    config: opts.config || {},
    handler
  })

  function handler (request, reply) {
    let dest = request.raw.url
    dest = dest.replace(this.prefix, rewritePrefix)
    reply.from(dest || '/', replyOpts)
  }

  if (opts.websocket) {
    setupWebSocketProxy(fastify, opts)
  }
}

httpProxy[Symbol.for('plugin-meta')] = {
  fastify: '^3.0.0',
  name: 'fastify-http-proxy'
}

module.exports = httpProxy

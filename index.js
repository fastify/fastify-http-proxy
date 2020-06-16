'use strict'

const From = require('fastify-reply-from')
const WebSocketPlugin = require('fastify-websocket')
const WebSocket = require('ws')
const { pipeline } = require('stream')
const nonWsMethods = ['DELETE', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']

module.exports = async function (fastify, opts) {
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

  if (opts.websocket) {
    fastify.register(WebSocketPlugin, opts.websocket)
  }

  fastify.get('/', {
    preHandler,
    config: opts.config || {},
    handler,
    wsHandler
  })
  fastify.get('/*', {
    preHandler,
    config: opts.config || {},
    handler,
    wsHandler
  })

  fastify.route({
    url: '/',
    method: nonWsMethods,
    preHandler,
    config: opts.config || {},
    handler
  })
  fastify.route({
    url: '/*',
    method: nonWsMethods,
    preHandler,
    config: opts.config || {},
    handler
  })

  function handler (request, reply) {
    var dest = request.raw.url
    dest = dest.replace(this.prefix, rewritePrefix)
    reply.from(dest || '/', replyOpts)
  }

  function wsHandler (conn, req) {
    // TODO support paths and querystrings
    // TODO support rewriteHeader
    // TODO support rewritePrefix
    const ws = new WebSocket(opts.upstream)
    const stream = WebSocket.createWebSocketStream(ws)

    // TODO fastify-websocket should create a logger for each connection
    fastify.log.info('starting websocket tunnel')
    pipeline(conn, stream, conn, function (err) {
      if (err) {
        fastify.log.info({ err }, 'websocket tunnel terminated with error')
        return
      }
      fastify.log.info('websocket tunnel terminated')
    })
  }
}

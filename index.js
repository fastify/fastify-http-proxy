'use strict'
const From = require('@fastify/reply-from')
const WebSocket = require('ws')
const { convertUrlToWebSocket } = require('./utils')

const httpMethods = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']
const urlPattern = /^https?:\/\//

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

function isExternalUrl (url = '') {
  return urlPattern.test(url)
};

function proxyWebSockets (source, target) {
  function close (code, reason) {
    closeWebSocket(source, code, reason)
    closeWebSocket(target, code, reason)
  }

  source.on('message', (data, binary) => waitConnection(target, () => target.send(data, { binary })))
  source.on('ping', data => waitConnection(target, () => target.ping(data)))
  source.on('pong', data => waitConnection(target, () => target.pong(data)))
  source.on('close', close)
  source.on('error', error => close(1011, error.message))
  source.on('unexpected-response', () => close(1011, 'unexpected response'))

  // source WebSocket is already connected because it is created by ws server
  target.on('message', (data, binary) => source.send(data, { binary }))
  target.on('ping', data => source.ping(data))
  target.on('pong', data => source.pong(data))
  target.on('close', close)
  target.on('error', error => close(1011, error.message))
  target.on('unexpected-response', () => close(1011, 'unexpected response'))
}

class WebSocketProxy {
  constructor (fastify, wsServerOptions) {
    this.logger = fastify.log

    const wss = new WebSocket.Server({
      server: fastify.server,
      ...wsServerOptions
    })

    // To be able to close the HTTP server,
    // all WebSocket clients need to be disconnected.
    // Fastify is missing a pre-close event, or the ability to
    // add a hook before the server.close call. We need to resort
    // to monkeypatching for now.
    const oldClose = fastify.server.close
    fastify.server.close = function (done) {
      for (const client of wss.clients) {
        client.close()
      }
      oldClose.call(this, done)
    }

    wss.on('error', (err) => {
      this.logger.error(err)
    })

    wss.on('connection', this.handleConnection.bind(this))

    this.wss = wss
    this.prefixList = []
  }

  close (done) {
    this.wss.close(done)
  }

  addUpstream (prefix, rewritePrefix, upstream, wsClientOptions) {
    this.prefixList.push({
      prefix: new URL(prefix, 'ws://127.0.0.1').pathname,
      rewritePrefix,
      upstream: convertUrlToWebSocket(upstream),
      wsClientOptions
    })

    // sort by decreasing prefix length, so that findUpstreamUrl() does longest prefix match
    this.prefixList.sort((a, b) => b.prefix.length - a.prefix.length)
  }

  findUpstream (request) {
    const source = new URL(request.url, 'ws://127.0.0.1')
    for (const { prefix, rewritePrefix, upstream, wsClientOptions } of this.prefixList) {
      if (source.pathname.startsWith(prefix)) {
        const target = new URL(source.pathname.replace(prefix, rewritePrefix), upstream)
        target.search = source.search
        return { target, wsClientOptions }
      }
    }

    return undefined
  }

  handleConnection (source, request) {
    const upstream = this.findUpstream(request)
    if (!upstream) {
      this.logger.debug({ url: request.url }, 'not matching prefix')
      source.close()
      return
    }
    const { target: url, wsClientOptions } = upstream

    const subprotocols = []
    if (source.protocol) {
      subprotocols.push(source.protocol)
    }

    let optionsWs = {}
    if (request.headers.cookie) {
      const headers = { cookie: request.headers.cookie }
      optionsWs = { ...wsClientOptions, headers }
    } else {
      optionsWs = wsClientOptions
    }

    const target = new WebSocket(url, subprotocols, optionsWs)
    this.logger.debug({ url: url.href }, 'proxy websocket')
    proxyWebSockets(source, target)
  }
}

const httpWss = new WeakMap() // http.Server => WebSocketProxy

function setupWebSocketProxy (fastify, options, rewritePrefix) {
  let wsProxy = httpWss.get(fastify.server)
  if (!wsProxy) {
    wsProxy = new WebSocketProxy(fastify, options.wsServerOptions)
    httpWss.set(fastify.server, wsProxy)

    fastify.addHook('onClose', (instance, done) => {
      httpWss.delete(fastify.server)
      wsProxy.close(done)
    })
  }

  if (options.upstream !== '') {
    wsProxy.addUpstream(fastify.prefix, rewritePrefix, options.upstream, options.wsClientOptions)
  } else if (typeof options.replyOptions.getUpstream === 'function') {
    wsProxy.findUpstream = function (request) {
      const source = new URL(request.url, 'ws://127.0.0.1')
      const upstream = options.replyOptions.getUpstream(request, '')
      const target = new URL(source.pathname, upstream)
      target.protocol = upstream.indexOf('http:') === 0 ? 'ws:' : 'wss'
      target.search = source.search
      return { target, wsClientOptions: options.wsClientOptions }
    }
  }
}

function generateRewritePrefix (prefix = '', opts) {
  let rewritePrefix = opts.rewritePrefix || (opts.upstream ? new URL(opts.upstream).pathname : '/')

  if (!prefix.endsWith('/') && rewritePrefix.endsWith('/')) {
    rewritePrefix = rewritePrefix.slice(0, -1)
  }

  return rewritePrefix
}

async function httpProxy (fastify, opts) {
  if (!opts.upstream && !(opts.upstream === '' && opts.replyOptions && typeof opts.replyOptions.getUpstream === 'function')) {
    throw new Error('upstream must be specified')
  }

  const preHandler = opts.preHandler || opts.beforeHandler
  const rewritePrefix = generateRewritePrefix(fastify.prefix, opts)

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

  function rewriteHeaders (headers, req) {
    const location = headers.location
    if (location && !isExternalUrl(location)) {
      headers.location = location.replace(rewritePrefix, fastify.prefix)
    }
    if (oldRewriteHeaders) {
      headers = oldRewriteHeaders(headers, req)
    }
    return headers
  }

  function bodyParser (req, payload, done) {
    done(null, payload)
  }

  fastify.route({
    url: '/',
    method: opts.httpMethods || httpMethods,
    preHandler,
    config: opts.config || {},
    constraints: opts.constraints || {},
    handler
  })
  fastify.route({
    url: '/*',
    method: opts.httpMethods || httpMethods,
    preHandler,
    config: opts.config || {},
    constraints: opts.constraints || {},
    handler
  })

  function handler (request, reply) {
    const queryParamIndex = request.raw.url.indexOf('?')
    let dest = request.raw.url.slice(0, queryParamIndex !== -1 ? queryParamIndex : undefined)

    if (this.prefix.includes(':')) {
      const requestedPathElements = request.url.split('/')
      const prefixPathWithVariables = this.prefix.split('/').map((_, index) => requestedPathElements[index]).join('/')
      dest = dest.replace(prefixPathWithVariables, rewritePrefix)
    } else {
      dest = dest.replace(this.prefix, rewritePrefix)
    }
    reply.from(dest || '/', replyOpts)
  }

  if (opts.websocket) {
    setupWebSocketProxy(fastify, opts, rewritePrefix)
  }
}

httpProxy[Symbol.for('plugin-meta')] = {
  fastify: '4.x',
  name: '@fastify/http-proxy'
}

module.exports = httpProxy
module.exports.default = httpProxy
module.exports.fastifyHttpProxy = httpProxy

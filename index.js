'use strict'
const From = require('@fastify/reply-from')
const { ServerResponse } = require('node:http')
const WebSocket = require('ws')
const { convertUrlToWebSocket } = require('./utils')
const fp = require('fastify-plugin')
const qs = require('fast-querystring')

const httpMethods = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']
const urlPattern = /^https?:\/\//
const kWs = Symbol('ws')
const kWsHead = Symbol('wsHead')
const kWsUpgradeListener = Symbol('wsUpgradeListener')

function liftErrorCode (code) {
  /* c8 ignore start */
  if (typeof code !== 'number') {
    // Sometimes "close" event emits with a non-numeric value
    return 1011
  } else if (code === 1004 || code === 1005 || code === 1006) {
    // ws module forbid those error codes usage, lift to "application level" (4xxx)
    return 3000 + code
  } else {
    return code
  }
  /* c8 ignore stop */
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

function isExternalUrl (url) {
  return urlPattern.test(url)
}

function noop () { }

function proxyWebSockets (source, target) {
  function close (code, reason) {
    closeWebSocket(source, code, reason)
    closeWebSocket(target, code, reason)
  }

  source.on('message', (data, binary) => waitConnection(target, () => target.send(data, { binary })))
  /* c8 ignore start */
  source.on('ping', data => waitConnection(target, () => target.ping(data)))
  source.on('pong', data => waitConnection(target, () => target.pong(data)))
  /* c8 ignore stop */
  source.on('close', close)
  /* c8 ignore start */
  source.on('error', error => close(1011, error.message))
  source.on('unexpected-response', () => close(1011, 'unexpected response'))
  /* c8 ignore stop */

  // source WebSocket is already connected because it is created by ws server
  target.on('message', (data, binary) => source.send(data, { binary }))
  /* c8 ignore start */
  target.on('ping', data => source.ping(data))
  /* c8 ignore stop */
  target.on('pong', data => source.pong(data))
  target.on('close', close)
  /* c8 ignore start */
  target.on('error', error => close(1011, error.message))
  target.on('unexpected-response', () => close(1011, 'unexpected response'))
  /* c8 ignore stop */
}

function reconnect (targetParams) {
  const { url, subprotocols, optionsWs } = targetParams
  const target = new WebSocket(url, subprotocols, optionsWs)
  proxyWebSocketsWithReconnection(source, target, options, targetParams)
}

function proxyWebSocketsWithReconnection (source, target, options, targetParams) {
  function close (code, reason, closing) {
    source.pingTimer && clearTimeout(source.pingTimer)
    source.pingTimer = undefined

    closeWebSocket(source, code, reason)
    closeWebSocket(target, code, reason)

    if (closing) {
      source.terminate()
      target.terminate()
      return
    }

    console.log(' >>> reconnect')

    source.isAlive = false
    reconnect(targetParams)
  }

  source.isAlive = true
  source.on('message', (data, binary) => {
    source.isAlive = true
    waitConnection(target, () => target.send(data, { binary }))
  })
  /* c8 ignore start */
  source.on('ping', data => waitConnection(target, () => target.ping(data)))
  source.on('pong', data => {
    console.log(' >>> pong')
    source.isAlive = true
    waitConnection(target, () => target.pong(data))
  })
  /* c8 ignore stop */
  source.on('close', (code, reason) => {
    close(code, reason, true)
  })
  /* c8 ignore start */
  source.on('error', error => close(1011, error.message, false))
  source.on('unexpected-response', () => close(1011, 'unexpected response', false))
  /* c8 ignore stop */

  source.pingTimer = setInterval(() => {
    console.log(' >>> ping')
    if (source.isAlive === false) return source.terminate()
    source.isAlive = false
    source.ping()
  }, options.pingInterval).unref()

  // source WebSocket is already connected because it is created by ws server
  target.on('message', (data, binary) => source.send(data, { binary }))
  /* c8 ignore start */
  target.on('ping', data => source.ping(data))
  /* c8 ignore stop */
  target.on('pong', data => source.pong(data))
  target.on('close', (code, reason) => close(code, reason, true))
  /* c8 ignore start */
  target.on('error', error => close(1011, error.message, false))
  target.on('unexpected-response', () => close(1011, 'unexpected response', false))
  /* c8 ignore stop */
}

function handleUpgrade (fastify, rawRequest, socket, head) {
  // Save a reference to the socket and then dispatch the request through the normal fastify router so that it will invoke hooks and then eventually a route handler that might upgrade the socket.
  rawRequest[kWs] = socket
  rawRequest[kWsHead] = head

  const rawResponse = new ServerResponse(rawRequest)
  rawResponse.assignSocket(socket)
  fastify.routing(rawRequest, rawResponse)

  rawResponse.on('finish', () => {
    socket.destroy()
  })
}

class WebSocketProxy {
  constructor (fastify, { wsReconnect, wsServerOptions, wsClientOptions, upstream, wsUpstream, replyOptions: { getUpstream } = {} }) {
    this.logger = fastify.log
    this.wsClientOptions = {
      rewriteRequestHeaders: defaultWsHeadersRewrite,
      headers: {},
      ...wsClientOptions
    }
    this.upstream = upstream ? convertUrlToWebSocket(upstream) : ''
    this.wsUpstream = wsUpstream ? convertUrlToWebSocket(wsUpstream) : ''
    this.getUpstream = getUpstream
    this.wsReconnect = wsReconnect

    const wss = new WebSocket.Server({
      noServer: true,
      ...wsServerOptions
    })

    if (!fastify.server[kWsUpgradeListener]) {
      fastify.server[kWsUpgradeListener] = (rawRequest, socket, head) =>
        handleUpgrade(fastify, rawRequest, socket, head)
      fastify.server.on('upgrade', fastify.server[kWsUpgradeListener])
    }

    this.handleUpgrade = (request, dest, cb) => {
      wss.handleUpgrade(request.raw, request.raw[kWs], request.raw[kWsHead], (socket) => {
        this.handleConnection(socket, request, dest)
        cb()
      })
    }

    // To be able to close the HTTP server,
    // all WebSocket clients need to be disconnected.
    // Fastify is missing a pre-close event, or the ability to
    // add a hook before the server.close call. We need to resort
    // to monkeypatching for now.
    {
      const oldClose = fastify.server.close
      fastify.server.close = function (done) {
        wss.close(() => {
          oldClose.call(this, (err) => {
            done && done(err)
          })
        })
        for (const client of wss.clients) {
          client.close()
        }
      }
    }

    /* c8 ignore start */
    wss.on('error', (err) => {
      this.logger.error(err)
    })
    /* c8 ignore stop */

    this.wss = wss
    this.prefixList = []
  }

  findUpstream (request, dest) {
    const { search } = new URL(request.url, 'ws://127.0.0.1')

    if (typeof this.wsUpstream === 'string' && this.wsUpstream !== '') {
      const target = new URL(dest, this.wsUpstream)
      target.search = search
      return target
    }

    if (typeof this.upstream === 'string' && this.upstream !== '') {
      const target = new URL(dest, this.upstream)
      target.search = search
      return target
    }

    const upstream = this.getUpstream(request, '')
    const target = new URL(dest, upstream)
    /* c8 ignore next */
    target.protocol = upstream.indexOf('http:') === 0 ? 'ws:' : 'wss'
    target.search = search
    return target
  }

  handleConnection (source, request, dest) {
    const url = this.findUpstream(request, dest)
    const queryString = getQueryString(url.search, request.url, this.wsClientOptions, request)
    url.search = queryString

    const rewriteRequestHeaders = this.wsClientOptions.rewriteRequestHeaders
    const headersToRewrite = this.wsClientOptions.headers

    const subprotocols = []
    if (source.protocol) {
      subprotocols.push(source.protocol)
    }

    const headers = rewriteRequestHeaders(headersToRewrite, request)
    const optionsWs = { ...this.wsClientOptions, headers }

    const target = new WebSocket(url, subprotocols, optionsWs)
    this.logger.debug({ url: url.href }, 'proxy websocket')

    if (this.wsReconnect) {
      const targetParams = { url, subprotocols, optionsWs }
      proxyWebSocketsWithReconnection(source, target, this.wsReconnect, targetParams)
    } else {
      proxyWebSockets(source, target)
    }
  }
}

function getQueryString (search, reqUrl, opts, request) {
  if (typeof opts.queryString === 'function') {
    return '?' + opts.queryString(search, reqUrl, request)
  }

  if (opts.queryString) {
    return '?' + qs.stringify(opts.queryString)
  }

  if (search.length > 0) {
    return search
  }

  return ''
}

function defaultWsHeadersRewrite (headers, request) {
  if (request.headers.cookie) {
    return { ...headers, cookie: request.headers.cookie }
  }
  return { ...headers }
}

function generateRewritePrefix (prefix, opts) {
  let rewritePrefix = opts.rewritePrefix || (opts.upstream ? new URL(opts.upstream).pathname : '/')

  if (!prefix.endsWith('/') && rewritePrefix.endsWith('/')) {
    rewritePrefix = rewritePrefix.slice(0, -1)
  }

  return rewritePrefix
}

async function fastifyHttpProxy (fastify, opts) {
  if (!opts.upstream && !opts.websocket && !((opts.upstream === '' || opts.wsUpstream === '') && opts.replyOptions && typeof opts.replyOptions.getUpstream === 'function')) {
    throw new Error('upstream must be specified')
  }

  // TODO validate opts.wsReconnect

  const preHandler = opts.preHandler || opts.beforeHandler
  const rewritePrefix = generateRewritePrefix(fastify.prefix, opts)

  const fromOpts = Object.assign({}, opts)
  fromOpts.base = opts.upstream
  fromOpts.prefix = undefined

  const internalRewriteLocationHeader = opts.internalRewriteLocationHeader ?? true
  const oldRewriteHeaders = (opts.replyOptions || {}).rewriteHeaders
  const replyOpts = Object.assign({}, opts.replyOptions, {
    rewriteHeaders
  })
  fromOpts.rewriteHeaders = rewriteHeaders

  fastify.register(From, fromOpts)

  if (opts.preValidation) {
    fastify.addHook('preValidation', opts.preValidation)
  } else if (opts.proxyPayloads !== false) {
    fastify.addContentTypeParser('application/json', bodyParser)
    fastify.addContentTypeParser('*', bodyParser)
  }

  function rewriteHeaders (headers, req) {
    const location = headers.location
    if (location && !isExternalUrl(location) && internalRewriteLocationHeader) {
      headers.location = location.replace(rewritePrefix, fastify.prefix)
    }
    if (oldRewriteHeaders) {
      headers = oldRewriteHeaders(headers, req)
    }
    return headers
  }

  function bodyParser (_req, payload, done) {
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

  let wsProxy

  if (opts.websocket) {
    wsProxy = new WebSocketProxy(fastify, opts)
  }

  function extractUrlComponents (urlString) {
    const [path, queryString] = urlString.split('?', 2)
    const components = {
      path,
      queryParams: null
    }

    if (queryString) {
      components.queryParams = qs.parse(queryString)
    }

    return components
  }

  function handler (request, reply) {
    const { path, queryParams } = extractUrlComponents(request.url)
    let dest = path

    if (this.prefix.includes(':')) {
      const requestedPathElements = path.split('/')
      const prefixPathWithVariables = this.prefix.split('/').map((_, index) => requestedPathElements[index]).join('/')

      let rewritePrefixWithVariables = rewritePrefix
      for (const [name, value] of Object.entries(request.params)) {
        rewritePrefixWithVariables = rewritePrefixWithVariables.replace(`:${name}`, value)
      }

      dest = dest.replace(prefixPathWithVariables, rewritePrefixWithVariables)
      if (queryParams) {
        dest += `?${qs.stringify(queryParams)}`
      }
    } else {
      dest = dest.replace(this.prefix, rewritePrefix)
    }

    if (request.raw[kWs]) {
      reply.hijack()
      try {
        wsProxy.handleUpgrade(request, dest || '/', noop)
      } /* c8 ignore start */ catch (err) {
        request.log.warn({ err }, 'websocket proxy error')
      } /* c8 ignore stop */
      return
    }
    reply.from(dest || '/', replyOpts)
  }
}

// TODO if reconnect on close, terminate connections on shutdown

module.exports = fp(fastifyHttpProxy, {
  fastify: '5.x',
  name: '@fastify/http-proxy',
  encapsulate: true
})
module.exports.default = fastifyHttpProxy
module.exports.fastifyHttpProxy = fastifyHttpProxy

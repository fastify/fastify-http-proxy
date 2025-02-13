'use strict'
const { setTimeout: wait } = require('node:timers/promises')
const From = require('@fastify/reply-from')
const { ServerResponse } = require('node:http')
const WebSocket = require('ws')
const { convertUrlToWebSocket } = require('./utils')
const fp = require('fastify-plugin')
const qs = require('fast-querystring')
const { validateOptions } = require('./src/options')

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
  socket.isAlive = false
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

function waitForConnection (target, timeout) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      /* c8 ignore start */
      reject(new Error('WebSocket connection timeout'))
      /* c8 ignore stop */
    }, timeout)

    /* c8 ignore start */
    if (target.readyState === WebSocket.OPEN) {
      clearTimeout(timeoutId)
      return resolve()
    }
    /* c8 ignore stop */

    if (target.readyState === WebSocket.CONNECTING) {
      target.once('open', () => {
        clearTimeout(timeoutId)
        resolve()
      })
      target.once('error', (err) => {
        clearTimeout(timeoutId)
        reject(err)
      })
      /* c8 ignore start */
    } else {
      clearTimeout(timeoutId)
      reject(new Error('WebSocket is closed'))
    }
    /* c8 ignore stop */
  })
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

async function reconnect (logger, source, wsReconnectOptions, oldTarget, targetParams) {
  const { url, subprotocols, optionsWs } = targetParams

  let attempts = 0
  let target
  do {
    const reconnectWait = wsReconnectOptions.reconnectInterval * (wsReconnectOptions.reconnectDecay * attempts || 1)
    wsReconnectOptions.logs && logger.warn({ target: targetParams.url }, `proxy ws reconnect in ${reconnectWait} ms`)
    await wait(reconnectWait)

    try {
      target = new WebSocket(url, subprotocols, optionsWs)
      await waitForConnection(target, wsReconnectOptions.connectionTimeout)
    } catch (err) {
      wsReconnectOptions.logs && logger.error({ target: targetParams.url, err, attempts }, 'proxy ws reconnect error')
      attempts++
      target = undefined
    }
  } while (!target && attempts < wsReconnectOptions.maxReconnectionRetries)

  if (!target) {
    logger.error({ target: targetParams.url, attempts }, 'proxy ws failed to reconnect! No more retries')
    return
  }

  wsReconnectOptions.logs && logger.info({ target: targetParams.url, attempts }, 'proxy ws reconnected')
  wsReconnectOptions.onReconnect(oldTarget, target)
  proxyWebSocketsWithReconnection(logger, source, target, wsReconnectOptions, targetParams)
}

function proxyWebSocketsWithReconnection (logger, source, target, options, targetParams) {
  function close (code, reason) {
    target.pingTimer && clearTimeout(source.pingTimer)
    target.pingTimer = undefined

    // reconnect target as long as the source connection is active
    if (source.isAlive && (target.broken || options.reconnectOnClose)) {
      // clean up the target and related source listeners
      target.isAlive = false
      target.removeAllListeners()
      // need to specify the listeners to remove
      removeSourceListeners(source)

      reconnect(logger, source, options, target, targetParams)
      return
    }

    options.logs && logger.info({ msg: 'proxy ws close link' })
    closeWebSocket(source, code, reason)
    closeWebSocket(target, code, reason)
  }

  function removeSourceListeners (source) {
    source.off('message', sourceOnMessage)
    source.off('ping', sourceOnPing)
    source.off('pong', sourceOnPong)
    source.off('close', sourceOnClose)
    source.off('error', sourceOnError)
    source.off('unexpected-response', sourceOnUnexpectedResponse)
  }

  /* c8 ignore start */
  function sourceOnMessage (data, binary) {
    source.isAlive = true
    waitConnection(target, () => target.send(data, { binary }))
  }
  function sourceOnPing (data) {
    waitConnection(target, () => target.ping(data))
  }
  function sourceOnPong (data) {
    source.isAlive = true
    waitConnection(target, () => target.pong(data))
  }
  function sourceOnClose (code, reason) {
    options.logs && logger.warn({ target: targetParams.url, code, reason }, 'proxy ws source close event')
    close(code, reason)
  }
  function sourceOnError (error) {
    options.logs && logger.warn({ target: targetParams.url, error: error.message }, 'proxy ws source error event')
    close(1011, error.message)
  }
  function sourceOnUnexpectedResponse () {
    options.logs && logger.warn({ target: targetParams.url }, 'proxy ws source unexpected-response event')
    close(1011, 'unexpected response')
  }
  /* c8 ignore stop */

  // source is alive since it is created by the proxy service
  // the pinger is not set since we can't reconnect from here
  source.isAlive = true
  source.on('message', sourceOnMessage)
  source.on('ping', sourceOnPing)
  source.on('pong', sourceOnPong)
  source.on('close', sourceOnClose)
  source.on('error', sourceOnError)
  source.on('unexpected-response', sourceOnUnexpectedResponse)

  // source WebSocket is already connected because it is created by ws server
  /* c8 ignore start */
  target.on('message', (data, binary) => {
    target.isAlive = true
    source.send(data, { binary })
  })
  target.on('ping', data => {
    target.isAlive = true
    source.ping(data)
  })
  target.on('pong', data => {
    target.isAlive = true
    source.pong(data)
  })
  /* c8 ignore stop */
  target.on('close', (code, reason) => {
    options.logs && logger.warn({ target: targetParams.url, code, reason }, 'proxy ws target close event')
    close(code, reason)
  })
  /* c8 ignore start */
  target.on('error', error => {
    options.logs && logger.warn({ target: targetParams.url, error: error.message }, 'proxy ws target error event')
    close(1011, error.message)
  })
  target.on('unexpected-response', () => {
    options.logs && logger.warn({ target: targetParams.url }, 'proxy ws target unexpected-response event')
    close(1011, 'unexpected response')
  })
  /* c8 ignore stop */

  target.isAlive = true
  target.pingTimer = setInterval(() => {
    if (target.isAlive === false) {
      target.broken = true
      options.logs && logger.warn({ target: targetParams.url }, 'proxy ws connection is broken')
      target.pingTimer && clearInterval(target.pingTimer)
      target.pingTimer = undefined
      return target.terminate()
    }
    target.isAlive = false
    target.ping()
  }, options.pingInterval).unref()
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
      proxyWebSocketsWithReconnection(this.logger, source, target, this.wsReconnect, targetParams)
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
  opts = validateOptions(opts)

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

module.exports = fp(fastifyHttpProxy, {
  fastify: '5.x',
  name: '@fastify/http-proxy',
  encapsulate: true
})
module.exports.default = fastifyHttpProxy
module.exports.fastifyHttpProxy = fastifyHttpProxy

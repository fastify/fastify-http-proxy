'use strict'
const From = require('@fastify/reply-from')
const { ServerResponse } = require('http')
const WebSocket = require('ws')
const { convertUrlToWebSocket } = require('./utils')
const fp = require('fastify-plugin')

const httpMethods = [
  'DELETE',
  'GET',
  'HEAD',
  'PATCH',
  'POST',
  'PUT',
  'OPTIONS'
]
const urlPattern = /^https?:\/\//
const kWs = Symbol('ws')
const kWsHead = Symbol('wsHead')

function liftErrorCode (code) {
  /* istanbul ignore next */
  if (typeof code !== 'number') {
    // Sometimes "close" event emits with a non-numeric value
    return 1011
  } else if (code === 1004 || code === 1005 || code === 1006) {
    // ws module forbid those error codes usage, lift to "application level" (4xxx)
    return 3000 + code
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

function isExternalUrl (url) {
  return urlPattern.test(url)
}

function noop () {}

function proxyWebSockets (source, target) {
  function close (code, reason) {
    closeWebSocket(source, code, reason)
    closeWebSocket(target, code, reason)
  }

  source.on('message', (data, binary) =>
    waitConnection(target, () => target.send(data, { binary }))
  )
  /* istanbul ignore next */
  source.on('ping', (data) => waitConnection(target, () => target.ping(data)))
  /* istanbul ignore next */
  source.on('pong', (data) => waitConnection(target, () => target.pong(data)))
  source.on('close', close)
  /* istanbul ignore next */
  source.on('error', (error) => close(1011, error.message))
  /* istanbul ignore next */
  source.on('unexpected-response', () => close(1011, 'unexpected response'))

  // source WebSocket is already connected because it is created by ws server
  target.on('message', (data, binary) => source.send(data, { binary }))
  /* istanbul ignore next */
  target.on('ping', (data) => source.ping(data))
  /* istanbul ignore next */
  target.on('pong', (data) => source.pong(data))
  target.on('close', close)
  /* istanbul ignore next */
  target.on('error', (error) => close(1011, error.message))
  /* istanbul ignore next */
  target.on('unexpected-response', () => close(1011, 'unexpected response'))
}

class WebSocketProxy {
  constructor (fastify, wsServerOptions) {
    this.logger = fastify.log

    const wss = new WebSocket.Server({
      noServer: true,
      ...wsServerOptions
    })

    fastify.server.on('upgrade', (rawRequest, socket, head) => {
      // Save a reference to the socket and then dispatch the request through the normal fastify router so that it will invoke hooks and then eventually a route handler that might upgrade the socket.
      rawRequest[kWs] = socket
      rawRequest[kWsHead] = head

      const rawResponse = new ServerResponse(rawRequest)
      rawResponse.assignSocket(socket)
      fastify.routing(rawRequest, rawResponse)

      rawResponse.on('finish', () => {
        socket.destroy()
      })
    })

    this.handleUpgrade = (request, cb) => {
      wss.handleUpgrade(
        request.raw,
        request.raw[kWs],
        request.raw[kWsHead],
        (socket) => {
          this.handleConnection(socket, request)
          cb()
        }
      )
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
            /* istanbul ignore next */
            done && done(err)
          })
        })
        for (const client of wss.clients) {
          client.close()
        }
      }
    }

    /* istanbul ignore next */
    wss.on('error', (err) => {
      /* istanbul ignore next */
      this.logger.error(err)
    })

    this.wss = wss
    this.prefixList = []
  }

  addUpstream (prefix, rewritePrefix, upstream, wsUpstream, wsClientOptions) {
    this.prefixList.push({
      prefix: new URL(prefix, 'ws://127.0.0.1').pathname,
      rewritePrefix,
      upstream: convertUrlToWebSocket(upstream),
      wsUpstream: wsUpstream ? convertUrlToWebSocket(wsUpstream) : '',
      wsClientOptions
    })

    // sort by decreasing prefix length, so that findUpstreamUrl() does longest prefix match
    this.prefixList.sort((a, b) => b.prefix.length - a.prefix.length)
  }

  findUpstream (request) {
    const source = new URL(request.url, 'ws://127.0.0.1')

    for (const {
      prefix,
      rewritePrefix,
      upstream,
      wsUpstream,
      wsClientOptions
    } of this.prefixList) {
      if (wsUpstream) {
        const target = new URL(wsUpstream)
        target.search = source.search
        return { target, wsClientOptions }
      }

      if (source.pathname.startsWith(prefix)) {
        const target = new URL(
          source.pathname.replace(prefix, rewritePrefix),
          upstream
        )
        target.search = source.search
        return { target, wsClientOptions }
      }
    }

    /* istanbul ignore next */
    throw new Error(
      `no upstream found for ${request.url}. this should not happened. Please report to https://github.com/fastify/fastify-http-proxy`
    )
  }

  handleConnection (source, request) {
    const upstream = this.findUpstream(request)
    const { target: url, wsClientOptions } = upstream
    const rewriteRequestHeaders =
      wsClientOptions?.rewriteRequestHeaders || defaultWsHeadersRewrite
    const headersToRewrite = wsClientOptions?.headers || {}

    const subprotocols = []
    if (source.protocol) {
      subprotocols.push(source.protocol)
    }

    const headers = rewriteRequestHeaders(headersToRewrite, request)
    const optionsWs = { ...(wsClientOptions || {}), headers }

    const target = new WebSocket(url, subprotocols, optionsWs)
    this.logger.debug({ url: url.href }, 'proxy websocket')
    proxyWebSockets(source, target)
  }
}

function defaultWsHeadersRewrite (headers, request) {
  if (request.headers.cookie) {
    return { ...headers, cookie: request.headers.cookie }
  }
  return { ...headers }
}

const httpWss = new WeakMap() // http.Server => WebSocketProxy

function setupWebSocketProxy (fastify, options, rewritePrefix) {
  let wsProxy = httpWss.get(fastify.server)
  if (!wsProxy) {
    wsProxy = new WebSocketProxy(fastify, options.wsServerOptions)
    httpWss.set(fastify.server, wsProxy)
  }

  if (
    (typeof options.wsUpstream === 'string' && options.wsUpstream !== '') ||
    (typeof options.upstream === 'string' && options.upstream !== '')
  ) {
    wsProxy.addUpstream(
      fastify.prefix,
      rewritePrefix,
      options.upstream,
      options.wsUpstream,
      options.wsClientOptions
    )
    // The else block is validate earlier in the code
  } else {
    wsProxy.findUpstream = function (request) {
      const source = new URL(request.url, 'ws://127.0.0.1')
      const upstream = options.replyOptions.getUpstream(request, '')
      const target = new URL(source.pathname, upstream)
      /* istanbul ignore next */
      target.protocol = upstream.indexOf('http:') === 0 ? 'ws:' : 'wss'
      target.search = source.search
      return { target, wsClientOptions: options.wsClientOptions }
    }
  }
  return wsProxy
}

function generateRewritePrefix (prefix, opts) {
  let rewritePrefix =
    opts.rewritePrefix ||
    (opts.upstream ? new URL(opts.upstream).pathname : '/')

  if (!prefix.endsWith('/') && rewritePrefix.endsWith('/')) {
    rewritePrefix = rewritePrefix.slice(0, -1)
  }

  return rewritePrefix
}

async function fastifyHttpProxy (fastify, opts) {
  if (
    !opts.upstream &&
    !(
      opts.upstream === '' &&
      opts.replyOptions &&
      typeof opts.replyOptions.getUpstream === 'function'
    )
  ) {
    throw new Error('upstream must be specified')
  }

  const preHandler = opts.preHandler || opts.beforeHandler
  const rewritePrefix = generateRewritePrefix(fastify.prefix, opts)

  const fromOpts = Object.assign({}, opts)
  fromOpts.base = opts.upstream
  fromOpts.prefix = undefined

  const internalRewriteLocationHeader =
    opts.internalRewriteLocationHeader ?? true
  const oldRewriteHeaders = (opts.replyOptions || {}).rewriteHeaders
  const replyOpts = Object.assign({}, opts.replyOptions, {
    rewriteHeaders
  })
  fromOpts.rewriteHeaders = rewriteHeaders

  fastify.register(From, fromOpts)

  if (opts.preValidation === undefined && opts.proxyPayloads !== false) {
    fastify.addContentTypeParser('application/json', bodyParser)
    fastify.addContentTypeParser('*', bodyParser)
  }

  if (opts.preValidation) {
    fastify.addHook('preValidation', opts.preValidation)
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

  let wsProxy

  if (opts.websocket) {
    wsProxy = setupWebSocketProxy(fastify, opts, rewritePrefix)
  }

  function handler (request, reply) {
    if (request.raw[kWs]) {
      reply.hijack()
      try {
        wsProxy.handleUpgrade(request, noop)
      } catch (err) {
        /* istanbul ignore next */
        request.log.warn({ err }, 'websocket proxy error')
      }
      return
    }
    const queryParamIndex = request.raw.url.indexOf('?')
    let dest = request.raw.url.slice(
      0,
      queryParamIndex !== -1 ? queryParamIndex : undefined
    )

    if (this.prefix.includes(':')) {
      const requestedPathElements = request.url.split('/')
      const prefixPathWithVariables = this.prefix
        .split('/')
        .map((_, index) => requestedPathElements[index])
        .join('/')

      let rewritePrefixWithVariables = rewritePrefix
      for (const [name, value] of Object.entries(request.params)) {
        rewritePrefixWithVariables = rewritePrefixWithVariables.replace(
          `:${name}`,
          value
        )
      }

      dest = dest.replace(prefixPathWithVariables, rewritePrefixWithVariables)
    } else {
      dest = dest.replace(this.prefix, rewritePrefix)
    }
    reply.from(dest || '/', replyOpts)
  }
}

module.exports = fp(fastifyHttpProxy, {
  fastify: '4.x',
  name: '@fastify/http-proxy',
  encapsulate: true
})
module.exports.default = fastifyHttpProxy
module.exports.fastifyHttpProxy = fastifyHttpProxy

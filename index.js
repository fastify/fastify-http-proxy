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

  source.on('message', (data, binary) => waitConnection(target, () => target.send(data, { binary })))
  /* istanbul ignore next */
  source.on('ping', data => waitConnection(target, () => target.ping(data)))
  /* istanbul ignore next */
  source.on('pong', data => waitConnection(target, () => target.pong(data)))
  source.on('close', close)
  /* istanbul ignore next */
  source.on('error', error => close(1011, error.message))
  /* istanbul ignore next */
  source.on('unexpected-response', () => close(1011, 'unexpected response'))

  // source WebSocket is already connected because it is created by ws server
  target.on('message', (data, binary) => source.send(data, { binary }))
  /* istanbul ignore next */
  target.on('ping', data => source.ping(data))
  /* istanbul ignore next */
  target.on('pong', data => source.pong(data))
  target.on('close', close)
  /* istanbul ignore next */
  target.on('error', error => close(1011, error.message))
  /* istanbul ignore next */
  target.on('unexpected-response', () => close(1011, 'unexpected response'))
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
  constructor (fastify, { wsServerOptions, wsClientOptions, upstream, wsUpstream, replyOptions: { getUpstream } = {} }) {
    this.logger = fastify.log
    this.wsClientOptions = {
      rewriteRequestHeaders: defaultWsHeadersRewrite,
      headers: {},
      ...wsClientOptions
    }
    this.upstream = convertUrlToWebSocket(upstream)
    this.wsUpstream = wsUpstream ? convertUrlToWebSocket(wsUpstream) : ''
    this.getUpstream = getUpstream

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

  findUpstream (request, dest) {
    const { search, pathname } = new URL(request.url, 'ws://127.0.0.1')

    if (typeof this.wsUpstream === 'string' && this.wsUpstream !== '') {
      const target = new URL(this.wsUpstream)
      target.search = search
      target.pathname = target.pathname === '/' ? pathname : target.pathname
      return target
    }

    if (typeof this.upstream === 'string' && this.upstream !== '') {
      const target = new URL(dest, this.upstream)
      target.search = search
      return target
    }

    const upstream = this.getUpstream(request, '')
    const target = new URL(dest, upstream)
    /* istanbul ignore next */
    target.protocol = upstream.indexOf('http:') === 0 ? 'ws:' : 'wss'
    target.search = search
    return target
  }

  handleConnection (source, request, dest) {
    const url = this.findUpstream(request, dest)
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
    proxyWebSockets(source, target)
  }
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
  if (!opts.upstream && !(opts.upstream === '' && opts.replyOptions && typeof opts.replyOptions.getUpstream === 'function')) {
    throw new Error('upstream must be specified')
  }

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
      } catch (err) {
        /* istanbul ignore next */
        request.log.warn({ err }, 'websocket proxy error')
      }
      return
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

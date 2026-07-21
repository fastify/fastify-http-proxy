'use strict'

const { test } = require('node:test')
const { once } = require('node:events')
const net = require('node:net')

const Fastify = require('fastify')
const fastifyWebSocket = require('@fastify/websocket')
const proxy = require('..')
const WebSocket = require('ws')

const level = 'warn'

async function closeFastify (app) {
  if (app) {
    await app.close()
  }
}

function rawWebSocketUpgrade (port, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let response = ''
    let settled = false

    const timeout = setTimeout(() => {
      finish(new Error('Timed out waiting for upgrade response'))
    }, 2000)

    function finish (err, statusLine) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.destroy()
      if (err) reject(err)
      else resolve(statusLine)
    }

    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      response += chunk
      if (response.includes('\r\n\r\n')) {
        finish(null, response.slice(0, response.indexOf('\r\n')))
      }
    })
    socket.once('error', finish)
    socket.once('close', () => finish(new Error('Socket closed before receiving upgrade response')))
    socket.once('connect', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      )
    })
  })
}

async function proxyServer (t, backendURL, backendPath, proxyOptions, wrapperOptions) {
  const frontend = Fastify({ logger: { level } })
  const registerProxy = async fastify => {
    fastify.register(proxy, {
      upstream: backendURL + backendPath,
      ...proxyOptions
    })
  }

  if (wrapperOptions) {
    await frontend.register(registerProxy, wrapperOptions)
  } else {
    await registerProxy(frontend)
  }

  try {
    return [frontend, await frontend.listen({ port: 0 })]
  } catch (err) {
    await closeFastify(frontend)
    throw err
  }
}

async function processRequest (t, frontendURL, path, expected) {
  const url = new URL(path, frontendURL)
  const wsUrl = url.href.replace('http:', 'ws:')
  const ws = new WebSocket(wsUrl)
  let wsResult, gotResult

  try {
    await once(ws, 'open')
    t.assert.ok('socket connected')

    const [buf] = await Promise.race([once(ws, 'message'), once(ws, 'close')])
    if (buf instanceof Buffer) {
      wsResult = buf.toString()
    } else {
      wsResult = 'error'
    }
  } catch {
    wsResult = 'error'
    ws.terminate()
  }

  try {
    const response = await fetch(url)
    if (!response.ok) {
      gotResult = 'error'
    } else {
      gotResult = await response.text()
    }
  } catch {
    gotResult = 'error'
  }

  t.assert.strictEqual(wsResult, expected)
  t.assert.strictEqual(gotResult, expected)
}

async function handleProxy (info, { backendPath, proxyOptions, wrapperOptions }, expected, ...paths) {
  test(info, async function (t) {
    const backend = Fastify({ logger: { level } })
    const resources = { frontend: null }

    t.after(async () => {
      // Close the frontend before the backend to avoid timeouts
      await closeFastify(resources.frontend)
      await closeFastify(backend)
    })

    await backend.register(fastifyWebSocket)

    backend.get('/*', {
      handler: (req, reply) => {
        reply.send(req.url)
      },
      wsHandler: (socket, req) => {
        socket.send(req.url)

        socket.once('message', () => {
          socket.close()
        })
      }
    })

    const backendURL = await backend.listen({ port: 0 })

    const [frontend, frontendURL] = await proxyServer(t, backendURL, backendPath, proxyOptions, wrapperOptions)
    resources.frontend = frontend

    for (const path of paths) {
      await processRequest(t, frontendURL, path, expected(path))
    }
  })
}

handleProxy(
  'no prefix to `/`',
  {
    backendPath: '/',
    proxyOptions: { websocket: true }
  },
  path => path,
  '/',
  '/pub',
  '/pub/'
)

handleProxy(
  '`/pub/` to `/`',
  {
    backendPath: '/',
    proxyOptions: { websocket: true, prefix: '/pub/' }
  },
  path => path.startsWith('/pub/') ? path.replace('/pub/', '/') : 'error',
  '/',
  '/pub/',
  '/pub/test'
)

handleProxy(
  '`/pub/` to `/public/`',
  {
    backendPath: '/public/',
    proxyOptions: { websocket: true, prefix: '/pub/' }
  },
  path => path.startsWith('/pub/') ? path.replace('/pub/', '/public/') : 'error',
  '/',
  '/pub/',
  '/pub/test'
)

handleProxy(
  'wrapped `/pub/` to `/public/`',
  {
    backendPath: '/public/',
    proxyOptions: { websocket: true },
    wrapperOptions: { prefix: '/pub/' }
  },
  path => path.startsWith('/pub/') ? path.replace('/pub/', '/public/') : 'error',
  '/',
  '/pub/',
  '/pub/test'
)

handleProxy(
  'parameterized Unicode prefix',
  {
    backendPath: '/',
    proxyOptions: {
      websocket: true,
      prefix: '/api/:tenant',
      rewritePrefix: '/internal/:tenant'
    }
  },
  path => path.replace('/api/caf%C3%A9', '/internal/caf%C3%A9'),
  '/api/caf%C3%A9/socket'
)

handleProxy(
  'percent-encoded backslashes remain path data',
  {
    backendPath: '/internal',
    proxyOptions: { websocket: true, prefix: '/pub' }
  },
  () => '/internal/foo%5C..bar',
  '/pub/foo%5C..bar'
)

test('preRewrite cannot override the WebSocket upstream origin', async t => {
  const configuredUpstream = Fastify({ logger: { level } })
  const attackerUpstream = Fastify({ logger: { level } })
  const frontend = Fastify({ logger: { level } })

  t.after(async () => {
    await closeFastify(frontend)
    await closeFastify(attackerUpstream)
    await closeFastify(configuredUpstream)
  })

  await configuredUpstream.register(fastifyWebSocket)
  await attackerUpstream.register(fastifyWebSocket)

  let configuredUpstreamHit = false
  let attackerUpstreamHit = false
  configuredUpstream.get('/internal', { websocket: true }, socket => {
    configuredUpstreamHit = true
    socket.close()
  })
  attackerUpstream.get('/internal', { websocket: true }, socket => {
    attackerUpstreamHit = true
    socket.close()
  })

  await configuredUpstream.listen({ port: 0, host: '127.0.0.1' })
  await attackerUpstream.listen({ port: 0, host: '127.0.0.1' })

  frontend.register(proxy, {
    upstream: `ws://127.0.0.1:${configuredUpstream.server.address().port}`,
    websocket: true,
    prefix: '/pub',
    rewritePrefix: '/internal',
    preRewrite: url => {
      if (url === '/pub/absolute') return 'ws://fastify-http-proxy.invalid/internal'
      if (url === '/pub/malformed') return '/internal/%'
      if (url === '/pub/outside') return '/outside'
      return url.replace('/pub', '')
    }
  })
  await frontend.listen({ port: 0, host: '127.0.0.1' })

  const attackerPort = attackerUpstream.server.address().port
  const statusLine = await rawWebSocketUpgrade(
    frontend.server.address().port,
    `/pub//127.0.0.1:${attackerPort}/internal`
  )
  const absoluteStatusLine = await rawWebSocketUpgrade(
    frontend.server.address().port,
    '/pub/absolute'
  )
  const malformedStatusLine = await rawWebSocketUpgrade(
    frontend.server.address().port,
    '/pub/malformed'
  )
  const outsideStatusLine = await rawWebSocketUpgrade(
    frontend.server.address().port,
    '/pub/outside'
  )

  t.assert.strictEqual(statusLine, 'HTTP/1.1 400 Bad Request')
  t.assert.strictEqual(absoluteStatusLine, 'HTTP/1.1 400 Bad Request')
  t.assert.strictEqual(malformedStatusLine, 'HTTP/1.1 400 Bad Request')
  t.assert.strictEqual(outsideStatusLine, 'HTTP/1.1 400 Bad Request')
  t.assert.strictEqual(configuredUpstreamHit, false)
  t.assert.strictEqual(attackerUpstreamHit, false)
})

// @see https://github.com/fastify/fastify-http-proxy/security/advisories/GHSA-7hrw-592w-9wh2
const defaultProxyOptions = {
  websocket: true,
  prefix: '/pub',
  rewritePrefix: '/internal'
}
const parameterizedProxyOptions = {
  websocket: true,
  prefix: '/api/:tenant',
  rewritePrefix: '/internal/:tenant'
}
const escapeVectors = [
  ['/pub/../secret', '/secret'],
  ['/pub/%2E%2E/secret', '/secret'],
  ['/pub/%2e%2e/secret', '/secret'],
  ['/pub/.%2E/secret', '/secret'],
  ['/pub/%2E./secret', '/secret'],
  ['/pub/../internality/secret', '/internality/secret'],
  ['/pub/%2E%2E/internality/secret', '/internality/secret'],
  ['/pub/dir\\..\\..\\internality/secret', '/internality/secret'],
  ['/pub/%/secret', '/secret'],
  ['/api/../secret', '/secret', parameterizedProxyOptions],
  ['/api/%2E%2E/secret', '/secret', parameterizedProxyOptions],
  ['/api/..%2F..%2Fsecret', '/secret', parameterizedProxyOptions],
  ['/api/..\\..\\secret', '/secret', parameterizedProxyOptions],
  ['/api/..%5C..%5Csecret', '/secret', parameterizedProxyOptions]
]

for (const [vector, escapedPath, proxyOptions = defaultProxyOptions] of escapeVectors) {
  test(`WebSocket path ${vector} must not escape rewritePrefix`, async (t) => {
    const backend = Fastify({ logger: { level } })
    const frontend = Fastify({ logger: { level } })

    t.after(async () => {
      await closeFastify(frontend)
      await closeFastify(backend)
    })

    await backend.register(fastifyWebSocket)

    let escapedPathHit = false
    backend.get('/internal/*', { websocket: true }, (socket, req) => {
      socket.send('internal:' + req.url)
      socket.close()
    })
    backend.get(escapedPath, { websocket: true }, (socket) => {
      escapedPathHit = true
      socket.send('leaked')
      socket.close()
    })
    await backend.listen({ port: 0, host: '127.0.0.1' })

    frontend.register(proxy, {
      upstream: `ws://127.0.0.1:${backend.server.address().port}`,
      ...proxyOptions
    })
    await frontend.listen({ port: 0, host: '127.0.0.1' })

    const port = frontend.server.address().port
    const statusLine = await rawWebSocketUpgrade(port, vector)
    t.assert.strictEqual(statusLine, 'HTTP/1.1 400 Bad Request')
    t.assert.strictEqual(escapedPathHit, false)
  })
}

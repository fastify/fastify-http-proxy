'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')

// Spin up an upstream that answers every message with the path it was reached
// on, so each assertion checks both that the upgrade was proxied and where to.
async function createPathEchoUpstream (t) {
  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  wss.on('connection', (ws, request) => {
    ws.on('message', () => ws.send(request.url))
  })
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })
  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
  return `ws://127.0.0.1:${origin.address().port}`
}

async function createProxy (t, routerOptions, proxyOptions) {
  const server = Fastify({ routerOptions })
  server.register(proxy, { websocket: true, ...proxyOptions })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })
  return server
}

// Resolves with the upstream path, or rejects if the upgrade is refused.
async function upstreamPath (server, path) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}${path}`)
  const [event, ...args] = await Promise.race([
    once(ws, 'open').then(() => ['open']),
    once(ws, 'unexpected-response').then(([, response]) => ['unexpected-response', response])
  ])
  if (event === 'unexpected-response') {
    ws.terminate()
    throw new Error(`upgrade refused with ${args[0].statusCode}`)
  }
  ws.send('where')
  const [reply] = await once(ws, 'message')
  ws.close()
  await once(ws, 'close')
  return reply.toString()
}

// A second 'upgrade' listener, so the proxy has to decide by prefix whether an
// upgrade is its own instead of dispatching every upgrade.
function mountStandalone (t, server, ownedPath) {
  const wss = new WebSocket.Server({ noServer: true })
  wss.on('connection', (ws) => {
    ws.on('message', () => ws.send('standalone'))
  })
  t.after(() => { wss.close() })
  server.server.on('upgrade', (rawRequest, socket, head) => {
    if (rawRequest.url.split('?', 1)[0] === ownedPath) {
      wss.handleUpgrade(rawRequest, socket, head, (ws) => {
        wss.emit('connection', ws, rawRequest)
      })
    }
  })
}

test('websocket upgrades honour ignoreTrailingSlash', async (t) => {
  const upstream = await createPathEchoUpstream(t)

  const cases = [
    // [prefix, requested path, path seen by the upstream]
    ['/api', '/api', '/'],
    ['/api', '/api/', '/'],
    ['/api', '/api/nested', '/nested'],
    ['/api', '/api/nested/', '/nested/'],
    ['/api', '/api/?a=b', '/?a=b'],
    // Only reachable without the trailing slash because of ignoreTrailingSlash.
    ['/api/', '/api', '/'],
    ['/api/', '/api/', '/'],
    ['/api/', '/api/nested', '/nested']
  ]

  for (const [prefix, path, expected] of cases) {
    const server = await createProxy(t, { ignoreTrailingSlash: true }, { prefix, upstream })
    assert.strictEqual(await upstreamPath(server, path), expected, `prefix ${prefix}, path ${path}`)
  }
})

test('websocket upgrades honour ignoreTrailingSlash with rewritePrefix', async (t) => {
  const upstream = await createPathEchoUpstream(t)

  const cases = [
    // [prefix, rewritePrefix, requested path, path seen by the upstream]
    ['/api', '/internal', '/api', '/internal'],
    ['/api', '/internal', '/api/', '/internal/'],
    ['/api', '/internal', '/api/nested/', '/internal/nested/'],
    ['/api/', '/internal/', '/api', '/internal/'],
    ['/api/', '/internal/', '/api/', '/internal/'],
    ['/api/', '/internal/', '/api/nested', '/internal/nested']
  ]

  for (const [prefix, rewritePrefix, path, expected] of cases) {
    const server = await createProxy(t, { ignoreTrailingSlash: true }, { prefix, upstream, rewritePrefix })
    assert.strictEqual(await upstreamPath(server, path), expected, `prefix ${prefix}, path ${path}`)
  }
})

test('websocket upgrades honour ignoreTrailingSlash next to another upgrade listener', async (t) => {
  const upstream = await createPathEchoUpstream(t)

  for (const prefix of ['/api', '/api/']) {
    const server = await createProxy(t, { ignoreTrailingSlash: true }, { prefix, upstream })
    mountStandalone(t, server, '/standalone')

    assert.strictEqual(await upstreamPath(server, '/standalone'), 'standalone', `prefix ${prefix}`)
    assert.strictEqual(await upstreamPath(server, '/api'), '/', `prefix ${prefix}`)
    assert.strictEqual(await upstreamPath(server, '/api/'), '/', `prefix ${prefix}`)
  }
})

test('without ignoreTrailingSlash a trailing-slash prefix refuses the bare path', async (t) => {
  const upstream = await createPathEchoUpstream(t)
  const server = await createProxy(t, {}, { prefix: '/api/', upstream })

  assert.strictEqual(await upstreamPath(server, '/api/'), '/')
  await assert.rejects(upstreamPath(server, '/api'), /upgrade refused with 404/)
})

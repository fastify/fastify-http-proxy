'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const Fastify = require('fastify')
const proxy = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')

// Spin up an upstream echo server that prefixes every message it receives, so
// the proxied payload can be told apart from a locally handled one.
async function createEchoUpstream (t) {
  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  wss.on('connection', (ws) => {
    ws.on('message', (message) => ws.send(`proxied:${message}`))
  })
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })
  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
  return `ws://127.0.0.1:${origin.address().port}`
}

// A second, independent WebSocket endpoint mounted directly on the raw server.
// Its 'upgrade' listener is registered after the proxy's, so in the buggy
// behaviour the proxy hijacks (and 404s) the socket before this one can run.
function mountStandalone (t, server, ownedPath) {
  const wss = new WebSocket.Server({ noServer: true })
  wss.on('connection', (ws) => {
    ws.on('message', (message) => ws.send(`standalone:${message}`))
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

async function connect (port, path) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await once(ws, 'open')
  ws.send('hello')
  const [reply] = await once(ws, 'message')
  ws.close()
  await once(ws, 'close')
  return reply.toString()
}

test('does not hijack websocket upgrades outside a prefixed proxy', async (t) => {
  const upstream = await createEchoUpstream(t)

  const server = Fastify()
  server.register(proxy, { prefix: '/proxied', upstream, websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })
  const port = server.server.address().port

  mountStandalone(t, server, '/standalone')

  // Out of prefix: must reach the standalone handler, untouched by the proxy.
  assert.strictEqual(await connect(port, '/standalone'), 'standalone:hello')
  // In prefix (exact match): still proxied.
  assert.strictEqual(await connect(port, '/proxied'), 'proxied:hello')
  // In prefix (nested path): still proxied.
  assert.strictEqual(await connect(port, '/proxied/nested'), 'proxied:hello')
})

test('a prefix with a trailing slash is scoped correctly', async (t) => {
  const upstream = await createEchoUpstream(t)

  const server = Fastify()
  server.register(proxy, { prefix: '/pub/', upstream, websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })
  const port = server.server.address().port

  mountStandalone(t, server, '/standalone')

  // Out of prefix: handled by the standalone endpoint.
  assert.strictEqual(await connect(port, '/standalone'), 'standalone:hello')
  // In prefix: proxied to the upstream.
  assert.strictEqual(await connect(port, '/pub/nested'), 'proxied:hello')
})

test('a root proxy still owns upgrades when coexisting with another listener', async (t) => {
  const upstream = await createEchoUpstream(t)

  const server = Fastify()
  server.register(proxy, { upstream, websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })
  const port = server.server.address().port

  // Present only so the proxy is not the sole 'upgrade' listener; it claims a
  // path the root proxy is never asked about.
  mountStandalone(t, server, '/reserved')

  // The root proxy owns every path, so an arbitrary path is still proxied.
  assert.strictEqual(await connect(port, '/anything'), 'proxied:hello')
})

test('multiple proxies each own their own prefix', async (t) => {
  const upstream = await createEchoUpstream(t)

  const server = Fastify()
  server.register(proxy, { prefix: '/pub', upstream, websocket: true })
  server.register(proxy, { prefix: '/api', upstream, websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => { server.close() })
  const port = server.server.address().port

  mountStandalone(t, server, '/standalone')

  assert.strictEqual(await connect(port, '/standalone'), 'standalone:hello')
  assert.strictEqual(await connect(port, '/pub/x'), 'proxied:hello')
  assert.strictEqual(await connect(port, '/api/x'), 'proxied:hello')
})

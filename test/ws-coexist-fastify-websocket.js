'use strict'

// Regression test for https://github.com/fastify/fastify-http-proxy/issues/314:
// registering @fastify/websocket before the proxy crashed the process with
// ERR_HTTP_SOCKET_ASSIGNED, as both plugins assign a response to the socket.

const { test } = require('node:test')
const assert = require('node:assert')
const { once } = require('node:events')
const Fastify = require('fastify')
const fastifyWebSocket = require('@fastify/websocket')
const proxy = require('../')
const WebSocket = require('ws')

async function createUpstream (t) {
  const upstream = Fastify()
  await upstream.register(fastifyWebSocket)
  upstream.get('/*', { websocket: true }, (socket) => {
    socket.on('message', (message) => socket.send(`proxied:${message}`))
  })
  await upstream.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => upstream.close())
  return `http://127.0.0.1:${upstream.server.address().port}`
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

function registerLocalRoute (server) {
  server.register(async function (instance) {
    instance.get('/local', { websocket: true }, (socket) => {
      socket.on('message', (message) => socket.send(`local:${message}`))
    })
  })
}

for (const order of ['proxy first', '@fastify/websocket first']) {
  test(`coexists with @fastify/websocket (${order})`, async (t) => {
    const upstream = await createUpstream(t)

    // The original bug surfaced as an uncaughtException.
    const onUncaught = (err) => assert.fail(`uncaughtException: ${err.code || err.message}`)
    process.on('uncaughtException', onUncaught)
    t.after(() => process.off('uncaughtException', onUncaught))

    const server = Fastify()

    if (order === 'proxy first') {
      await server.register(proxy, { prefix: '/api', upstream, websocket: true })
      await server.register(fastifyWebSocket)
    } else {
      await server.register(fastifyWebSocket)
      await server.register(proxy, { prefix: '/api', upstream, websocket: true })
    }
    registerLocalRoute(server)

    await server.listen({ port: 0, host: '127.0.0.1' })
    t.after(() => server.close())
    const port = server.server.address().port

    // Proxied endpoint: exact prefix and nested path.
    assert.strictEqual(await connect(port, '/api'), 'proxied:hello')
    assert.strictEqual(await connect(port, '/api/nested'), 'proxied:hello')
    // Local @fastify/websocket route, outside the proxy prefix.
    assert.strictEqual(await connect(port, '/local'), 'local:hello')
  })
}

test('the proxy listener runs first regardless of registration order', async (t) => {
  const upstream = await createUpstream(t)

  const server = Fastify()
  await server.register(fastifyWebSocket)
  await server.register(proxy, { prefix: '/api', upstream, websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())

  const listeners = server.server.listeners('upgrade')
  assert.ok(listeners.length >= 2, 'both plugins registered an upgrade listener')
  // The proxy listener is prepended, @fastify/websocket's is last.
  assert.notStrictEqual(listeners[0].name, 'onUpgrade')
  assert.strictEqual(listeners[listeners.length - 1].name, 'onUpgrade')
})

test('skips sockets already claimed by another upgrade listener', async (t) => {
  const upstream = await createUpstream(t)

  const server = Fastify()
  await server.register(proxy, { prefix: '/api', upstream, websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())
  const port = server.server.address().port

  // A listener ahead of the proxy claims a proxy-owned path: no throw.
  const wss = new WebSocket.Server({ noServer: true })
  wss.on('connection', (ws) => {
    ws.on('message', (message) => ws.send(`first:${message}`))
  })
  t.after(() => wss.close())
  server.server.prependListener('upgrade', (rawRequest, socket, head) => {
    const { ServerResponse } = require('node:http')
    new ServerResponse(rawRequest).assignSocket(socket)
    wss.handleUpgrade(rawRequest, socket, head, (ws) => wss.emit('connection', ws, rawRequest))
  })

  assert.strictEqual(await connect(port, '/api/claimed'), 'first:hello')
})

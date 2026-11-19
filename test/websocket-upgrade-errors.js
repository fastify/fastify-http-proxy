'use strict'

const { test } = require('node:test')
const net = require('node:net')
const { once } = require('node:events')
const { createServer } = require('node:http')
const Fastify = require('fastify')
const WebSocket = require('ws')
const proxy = require('../')

// A text frame without the mask bit: invalid when sent by a client (RFC 6455, 5.1).
const UNMASKED_TEXT_FRAME = Buffer.from([0x81, 0x01, 0x41])

async function startUpstream (t) {
  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })
  t.after(() => { wss.close() })
  t.after(() => { origin.close() })

  const connections = []
  wss.on('connection', (ws, request) => {
    connections.push(request.url)
    ws.on('message', (data, binary) => ws.send(data, { binary }))
  })

  origin.listen({ port: 0, host: '127.0.0.1' })
  await once(origin, 'listening')
  return { origin, connections }
}

// Sends a raw upgrade request (so the request-target is not normalized by a
// WebSocket client), then one invalid frame. Resolves with the status code once
// the proxy closes the connection.
function rawUpgrade (port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write([
        `GET ${target} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '', ''
      ].join('\r\n'))
    })
    let status = null
    socket.on('error', () => {})
    socket.once('data', (head) => {
      status = Number(head.toString('latin1').split(' ')[1])
      socket.write(UNMASKED_TEXT_FRAME)
    })
    socket.on('close', () => resolve(status))
    socket.setTimeout(5000, () => {
      socket.destroy()
      reject(new Error('the proxy did not close the connection'))
    })
  })
}

async function assertStillServing (t, server) {
  const res = await server.inject({ method: 'GET', url: '/health' })
  t.assert.strictEqual(res.statusCode, 200)
}

for (const target of ['/echo#x', '/echo#x?a=1']) {
  test(`websocket upgrade with a fragment in the path (${target}) does not crash the process`, async (t) => {
    const { origin, connections } = await startUpstream(t)

    const server = Fastify()
    server.get('/health', async () => 'ok')
    server.register(proxy, {
      upstream: `http://127.0.0.1:${origin.address().port}`,
      prefix: '/',
      websocket: true
    })
    await server.listen({ port: 0, host: '127.0.0.1' })
    t.after(() => server.close())

    const status = await rawUpgrade(server.server.address().port, target)
    t.assert.strictEqual(status, 101)
    // The fragment (including anything that follows '#') is not forwarded.
    t.assert.deepStrictEqual(connections, ['/echo'])
    await assertStillServing(t, server)
  })
}

test('websocket upgrade with a query string followed by a fragment keeps the query string', async (t) => {
  const { origin, connections } = await startUpstream(t)

  const server = Fastify()
  server.register(proxy, {
    upstream: `http://127.0.0.1:${origin.address().port}`,
    websocket: true
  })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())

  const status = await rawUpgrade(server.server.address().port, '/echo?a=1#x')
  t.assert.strictEqual(status, 101)
  t.assert.deepStrictEqual(connections, ['/echo?a=1'])
})

test('websocket upgrade terminates the client when the upstream link cannot be created', async (t) => {
  const { origin, connections } = await startUpstream(t)

  const server = Fastify()
  server.get('/health', async () => 'ok')
  server.register(proxy, {
    upstream: `http://127.0.0.1:${origin.address().port}`,
    websocket: true,
    wsClientOptions: {
      rewriteRequestHeaders () {
        throw new Error('kaboom')
      }
    }
  })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())

  const status = await rawUpgrade(server.server.address().port, '/echo')
  t.assert.strictEqual(status, 101)
  t.assert.deepStrictEqual(connections, [])
  await assertStillServing(t, server)
})

test('websocket upgrade with a request-target that is not a valid URL reference does not crash the process', async (t) => {
  const { origin } = await startUpstream(t)

  const server = Fastify({ routerOptions: { ignoreDuplicateSlashes: true } })
  server.get('/health', async () => 'ok')
  server.register(proxy, {
    upstream: `http://127.0.0.1:${origin.address().port}`,
    prefix: '/:tenant/ws',
    websocket: true
  })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())

  await rawUpgrade(server.server.address().port, '//a:99999999/ws/x')
  await assertStillServing(t, server)
})

test('websocket upgrade terminates the upstream client when a post-handshake step throws', async (t) => {
  // A logger whose debug() throws is the one synchronous step between creating
  // the upstream client and wiring its 'error' listener. Without terminating
  // the upstream socket, its connection error to the closed port below would be
  // an unhandled 'error' event and crash the process.
  const throwingLogger = {
    level: 'info',
    fatal () {},
    error () {},
    warn () {},
    info () {},
    debug () { throw new Error('kaboom') },
    trace () {},
    child () { return throwingLogger }
  }

  const server = Fastify({ loggerInstance: throwingLogger })
  server.get('/health', async () => 'ok')
  server.register(proxy, {
    // A closed port, so the orphaned upstream client emits ECONNREFUSED.
    upstream: 'http://127.0.0.1:1',
    websocket: true
  })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())

  const status = await rawUpgrade(server.server.address().port, '/echo')
  t.assert.strictEqual(status, 101)
  await assertStillServing(t, server)
})

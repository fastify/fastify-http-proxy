'use strict'

const { test } = require('node:test')
const net = require('node:net')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')
const Fastify = require('fastify')
const proxy = require('../')

const UPGRADE_REQUEST = [
  'GET /api/b HTTP/1.1',
  'Host: 127.0.0.1',
  'Connection: Upgrade',
  'Upgrade: websocket',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
  'Sec-WebSocket-Version: 13',
  '', ''
].join('\r\n')

async function createServer (t, firstRouteDelay = 0) {
  const server = Fastify()
  server.get('/health', async () => 'ok')
  server.get('/first', async () => {
    if (firstRouteDelay) await sleep(firstRouteDelay)
    return 'first'
  })
  // The upstream is never reached: the pipelined upgrade is not proxied.
  server.register(proxy, { upstream: 'http://127.0.0.1:1', prefix: '/api', websocket: true })
  await server.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => server.close())
  return server
}

// Writes a plain request and an upgrade request in a single packet, so the
// upgrade is parsed while the first response is still attached to the socket.
function sendPipelined (port) {
  const socket = net.connect(port, '127.0.0.1', () => {
    socket.write('GET /first HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n' + UPGRADE_REQUEST)
  })
  socket.on('error', () => {})
  let received = ''
  socket.on('data', (chunk) => { received += chunk.toString('latin1') })
  return { socket, received: () => received }
}

async function assertStillServing (t, server) {
  const res = await server.inject({ method: 'GET', url: '/health' })
  t.assert.strictEqual(res.statusCode, 200)
}

test('a TCP reset after an upgrade pipelined behind a request does not crash the process', async (t) => {
  const server = await createServer(t, 300)
  const { socket } = sendPipelined(server.server.address().port)
  await sleep(100)
  socket.resetAndDestroy()
  await once(socket, 'close')
  await sleep(50)
  await assertStillServing(t, server)
})

for (const [label, delay] of [['already sent', 0], ['still pending', 100]]) {
  test(`an upgrade pipelined behind a request is closed after the response (${label})`, async (t) => {
    const server = await createServer(t, delay)
    const { socket, received } = sendPipelined(server.server.address().port)
    // The server closes the connection itself: the socket is not retained.
    await once(socket, 'close')
    t.assert.match(received(), /^HTTP\/1\.1 200 OK\r\n[\s\S]*\r\n\r\nfirst$/)
    await assertStillServing(t, server)
  })
}

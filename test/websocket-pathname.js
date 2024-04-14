const { test } = require('tap')
const Fastify = require('fastify')
const proxy = require('..')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')

// TODO: this test is flaky, probably because of promise resolution
test('keep proxy websocket pathname', async (t) => {
  t.plan(5)

  const origin = createServer()
  const wss = new WebSocket.Server({ server: origin })

  t.teardown(wss.close.bind(wss))
  t.teardown(origin.close.bind(origin))

  const serverMessages = []
  wss.on('connection', (ws, request) => {
    ws.on('message', (message, binary) => {
      // Also need save request.url for check from what url the message is coming.
      serverMessages.push([message.toString(), binary, request.headers.host.split(':', 1)[0], request.url])
      ws.send(message, { binary })
    })
  })

  await promisify(origin.listen.bind(origin))({ port: 0, host: '127.0.0.1' })
  // Host for wsUpstream and for later check.
  const host = '127.0.0.1'
  // Path for wsUpstream and for later check.
  const path = '/keep/path'
  const server = Fastify()
  server.register(proxy, {
    upstream: `ws://127.0.0.1:${origin.address().port}`,
    // Start proxy with different upstream, without path
    wsUpstream: `ws://${host}:${origin.address().port}`,
    websocket: true
  })

  await server.listen({ port: 0, host: '127.0.0.1' })
  t.teardown(server.close.bind(server))

  // Start websocket with different upstream for connect, added path.
  const ws = new WebSocket(`ws://${host}:${server.server.address().port}${path}`)
  await once(ws, 'open')

  const data = [{ message: 'hello', binary: false }, { message: 'fastify', binary: true, isBuffer: true }]
  const dataLength = data.length
  let dataIndex = 0

  for (; dataIndex < dataLength; dataIndex++) {
    const { message: msg, binary, isBuffer } = data[dataIndex]
    const message = isBuffer
      ? Buffer.from(msg)
      : msg

    ws.send(message, { binary })

    const [reply, binaryAnswer] = await once(ws, 'message')

    t.equal(reply.toString(), msg)
    t.equal(binaryAnswer, binary)
  }
  // Also check "path", must be the same.
  t.strictSame(serverMessages, [
    ['hello', false, host, path],
    ['fastify', true, host, path]
  ])

  await Promise.all([
    once(ws, 'close'),
    server.close()
  ])
})

'use strict'

const { test } = require('node:test')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const Fastify = require('fastify')
const WebSocket = require('ws')
const proxyPlugin = require('../')

for (const wsReconnect of [undefined, { pingInterval: 60_000 }]) {
  const suffix = wsReconnect ? ' (with reconnection)' : ''

  test(`closes the target when the client leaves before the target is connected${suffix}`, async (t) => {
    // An upstream that holds the handshake until told to complete it.
    const targetServer = createServer()
    const targetWs = new WebSocket.Server({ noServer: true })
    let completeHandshake
    const handshake = new Promise(resolve => { completeHandshake = resolve })
    const targetConnected = once(targetWs, 'connection')
    targetServer.on('upgrade', async (request, socket, head) => {
      await handshake
      targetWs.handleUpgrade(request, socket, head, (ws) => targetWs.emit('connection', ws))
    })
    await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

    const proxy = Fastify()
    proxy.register(proxyPlugin, {
      upstream: `ws://127.0.0.1:${targetServer.address().port}`,
      websocket: true,
      wsReconnect
    })
    await proxy.listen({ port: 0, host: '127.0.0.1' })
    const sourceSocketClosed = new Promise(resolve => {
      proxy.server.once('connection', (socket) => socket.once('close', resolve))
    })

    t.after(async () => {
      for (const ws of targetWs.clients) {
        ws.terminate()
      }
      targetWs.close()
      targetServer.close()
      await proxy.close()
    })

    const client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
    await once(client, 'open')

    // the client leaves, and the proxy notices, while the target is still connecting
    client.terminate()
    await sourceSocketClosed
    await new Promise(resolve => setImmediate(resolve))

    completeHandshake()
    const [targetSide] = await targetConnected

    // the proxy closes the connection it has no client for
    if (targetSide.readyState !== WebSocket.CLOSED) {
      await once(targetSide, 'close')
    }
    t.assert.strictEqual(targetWs.clients.size, 0)
  })
}

'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxyPlugin = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { setTimeout } = require('node:timers/promises')

async function createServices ({ t, wsReconnectOptions, wsTargetOptions, wsServerOptions }) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ server: targetServer, ...wsTargetOptions })

  await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

  // TODO pino-test
  const proxy = Fastify()
  proxy.register(proxyPlugin, {
    upstream: `ws://127.0.0.1:${targetServer.address().port}`,
    websocket: true,
    wsReconnect: wsReconnectOptions,
    wsServerOptions
  })

  await proxy.listen({ port: 0, host: '127.0.0.1' })

  const client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
  await once(client, 'open')

  t.teardown(async () => {
    client.close()
    targetWs.close()
    targetServer.close()
    await proxy.close()
  })

  return {
    target: {
      ws: targetWs,
      server: targetServer
    },
    proxy,
    client
  }
}

// TODO use fake timers

// test('should use ping/pong to verify connection is alive - from source (server on proxy) to target', async (t) => {
//   const wsReconnectOptions = { pingInterval: 100 }

//   const { target } = await createServices({ t, wsReconnectOptions })

//   let counter = 0
//   target.ws.on('connection', function connection (ws) {
//     ws.on('ping', (data) => {
//       console.log(' *** ping', data)
//       counter++
//     })

//     ws.on('pong', (data) => {
//       console.log(' *** pong', data)
//     })
//   })

//   await setTimeout(250)

//   t.ok(counter > 0)
// })

test('should reconnect on broken connection', async (t) => {
  const wsReconnectOptions = { pingInterval: 250 }

  const { target } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  target.ws.on('connection', async (ws) => {
    console.log(' *** connection ...')

    ws.on('ping', async (data) => {
      console.log(' *** received ping:', data)
      // latency to break the connection
      await setTimeout(1000)
      ws.pong(data)
      console.log(' *** sent pong after delay')
    })
  })
  await setTimeout(3000)
})

/*
test('should reconnect on source close', async (t) => {})
test('should reconnect on target close', async (t) => {})
test('should reconnect on source error', async (t) => {})
test('should reconnect on target error', async (t) => {})
test('should reconnect on source unexpected-response', async (t) => {})
test('should reconnect on target unexpected-response', async (t) => {})
test('should reconnect on target connection timeout', async (t) => {})

    if reconnectOnClose ... on shutdown

    with multiple upstreams
*/

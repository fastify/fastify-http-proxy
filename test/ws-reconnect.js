'use strict'

const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { setTimeout: wait } = require('node:timers/promises')
const { test } = require('tap')
const Fastify = require('fastify')
const WebSocket = require('ws')
const proxyPlugin = require('../')
const { createLoggerSpy } = require('./helper/helper')

async function createServices ({ t, wsReconnectOptions, wsTargetOptions, wsServerOptions }) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ server: targetServer, ...wsTargetOptions })

  await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

  const logger = createLoggerSpy()
  const proxy = Fastify({ loggerInstance: logger })
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
    client,
    logger
  }
}

// TODO use fake timers ?

/*
test('should use ping/pong to verify connection is alive - from source (server on proxy) to target', async (t) => {
  const wsReconnectOptions = { pingInterval: 100, reconnectInterval: 100, maxReconnectionRetries: 1 }

  const { target } = await createServices({ t, wsReconnectOptions })

  let counter = 0
  target.ws.on('connection', function connection (socket) {
    socket.on('ping', () => {
      counter++
    })
  })

  await wait(250)

  t.ok(counter > 0)
})

test('should reconnect on broken connection', async (t) => {
  const wsReconnectOptions = { pingInterval: 250, reconnectInterval: 100, maxReconnectionRetries: 1, reconnectDecay: 2 }

  const { target, logger } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection
      await wait(500)
      socket.pong()
    })
  })
  await wait(1000)

  t.ok(logger._warn.find(l => l[1] === 'proxy ws connection is broken'))
  t.ok(logger._info.find(l => l[1] === 'proxy ws reconnecting in 100 ms'))
  t.ok(logger._info.find(l => l[1] === 'proxy ws reconnected'))
})
*/

test('should reconnect after failingwith retries', async (t) => {
  const wsReconnectOptions = { pingInterval: 150, reconnectInterval: 100, reconnectOnClose: true }

  const { target, logger } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  const refuseNewConnections = false

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection
      await wait(500)
      socket.pong()
    })
  })

  target.ws.on('upgrade', (request, socket, head) => {
    if (refuseNewConnections) {
      socket.destroy()
    }
  })

  // TODO use pino-test
  // await pinoTest.once(logger, 'warn', 'proxy ws connection is broken')

  // close the target server to fail new connections
  // setTimeout(() => {
  //   refuseNewConnections = true
  //   setTimeout(() => {
  //     refuseNewConnections = false
  //   }, 500)
  // }, 1000)

  // t.ok(logger._warn.find(l => l[1] === 'proxy ws connection is broken'))
  // t.ok(logger._info.find(l => l[1] === 'proxy ws reconnecting in 100 ms'))
  // t.ok(logger._error.find(l => l[1] === 'proxy ws reconnect error' && l[0].attempts === 1))
  // t.ok(logger._info.find(l => l[1] === 'proxy ws reconnected' && l[0].attempts === 2))
})

// TODO reconnect fails becase of timeout
// cant reconnect
// TODO reconnect on close/error/unexpected-response
// TODO reconnectOnClose ... on shutdown
// TODO check only socket to target

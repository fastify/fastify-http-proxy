'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { setTimeout: wait } = require('node:timers/promises')
const Fastify = require('fastify')
const WebSocket = require('ws')
const pinoTest = require('pino-test')
const pino = require('pino')
const proxyPlugin = require('../')

function waitForLogMessage (loggerSpy, message, max = 100) {
  return new Promise((resolve, reject) => {
    let count = 0
    const fn = (received) => {
      console.log(received)

      if (received.msg === message) {
        loggerSpy.off('data', fn)
        resolve()
      }
      count++
      if (count > max) {
        loggerSpy.off('data', fn)
        reject(new Error(`Max message count reached on waitForLogMessage: ${message}`))
      }
    }
    loggerSpy.on('data', fn)
  })
}

async function createServices ({ t, upstream, wsReconnectOptions, wsTargetOptions, wsServerOptions }) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ server: targetServer, ...wsTargetOptions })

  await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

  const loggerSpy = pinoTest.sink()
  const logger = pino(loggerSpy)
  const proxy = Fastify({ loggerInstance: logger })
  proxy.register(proxyPlugin, {
    upstream: upstream || `ws://127.0.0.1:${targetServer.address().port}`,
    websocket: true,
    wsReconnect: wsReconnectOptions,
    wsServerOptions
  })

  await proxy.listen({ port: 0, host: '127.0.0.1' })

  const client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
  await once(client, 'open')

  t.after(async () => {
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
    loggerSpy,
    upstream
  }
}

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

  assert.ok(counter > 0)
})

test('should reconnect on broken connection', async (t) => {
  const wsReconnectOptions = { pingInterval: 500, reconnectInterval: 100, maxReconnectionRetries: 1, reconnectDecay: 2, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  const breakConnection = true
  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection once
      if (breakConnection) {
        await wait(wsReconnectOptions.pingInterval * 2)
        // breakConnection = false
      }
      socket.pong()
    })
  })

  await wait(10_000)

  await waitForLogMessage(loggerSpy, 'proxy ws connection is broken')
  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
})

test('should not reconnect after max retries', async (t) => {
  const wsReconnectOptions = { pingInterval: 150, reconnectInterval: 100, maxReconnectionRetries: 1, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  let breakConnection = true

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection once
      if (breakConnection) {
        await wait(wsReconnectOptions.pingInterval * 2)
        breakConnection = false
      }
      socket.pong()
    })
  })

  await waitForLogMessage(loggerSpy, 'proxy ws connection is broken')

  target.ws.close()
  target.server.close()

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnect error')
  await waitForLogMessage(loggerSpy, 'proxy ws failed to reconnect! No more retries')
})

test('should reconnect on regular target connection close', async (t) => {
  const wsReconnectOptions = { pingInterval: 200, reconnectInterval: 100, maxReconnectionRetries: 1, reconnectOnClose: false, logs: true }

  const { target, loggerSpy } = await createServices({ t, wsReconnectOptions })

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      socket.pong()
    })

    await wait(1_000)
    socket.close()
  })

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws close link')
})

/*
TODO fix
test('should reconnect with retry', async (t) => {
  const wsReconnectOptions = { pingInterval: 150, reconnectInterval: 100, reconnectOnClose: true }

  const { target, loggerSpy, upstream } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  let breakConnection = true

  target.ws.on('connection', async (socket) => {
    socket.on('ping', async () => {
      // add latency to break the connection once
      if (breakConnection) {
        await wait(wsReconnectOptions.pingInterval * 2)
        breakConnection = false
      }
      socket.pong()
    })
  })

  await waitForLogMessage(loggerSpy, 'proxy ws connection is broken')

  // recreate a new target with the same upstream

  target.ws.close()
  target.server.close()
  await createServices({ t, upstream, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

  await waitForLogMessage(loggerSpy, 'proxy ws target close event')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnect error')
  await waitForLogMessage(loggerSpy, 'proxy ws reconnected')
})
*/

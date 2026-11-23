'use strict'

const { test } = require('node:test')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { setTimeout: wait } = require('node:timers/promises')
const Fastify = require('fastify')
const WebSocket = require('ws')
const proxyPlugin = require('../')

const MESSAGE_SIZE = 256 * 1024
const MESSAGES = 128 // 32 MiB overall, far more than the kernel buffers can absorb

async function setup (t, { wsHighWaterMark, wsReconnect, wsForwardPings, onTargetConnection }) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ server: targetServer })
  targetWs.on('connection', onTargetConnection)
  await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

  const link = { incoming: 0, outgoing: 0 }
  const proxy = Fastify()
  proxy.register(proxyPlugin, {
    upstream: `ws://127.0.0.1:${targetServer.address().port}`,
    websocket: true,
    wsHighWaterMark,
    wsReconnect,
    wsForwardPings,
    wsHooks: {
      onConnect (_context, source, target) {
        link.source = source
        link.target = target
      },
      onIncomingMessage () { link.incoming++ },
      onOutgoingMessage () { link.outgoing++ }
    }
  })
  await proxy.listen({ port: 0, host: '127.0.0.1' })

  const client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
  client.on('error', () => {})
  await once(client, 'open')

  t.after(async () => {
    client.terminate()
    for (const ws of targetWs.clients) {
      ws.terminate()
    }
    targetWs.close()
    targetServer.close()
    await proxy.close()
  })

  return { client, link }
}

async function until (condition, message) {
  for (let i = 0; i < 500; i++) {
    if (condition()) {
      return
    }
    await wait(10)
  }
  throw new Error(`timeout waiting for: ${message}`)
}

function sendAll (ws) {
  const payload = Buffer.alloc(MESSAGE_SIZE, 'a')
  for (let i = 0; i < MESSAGES; i++) {
    payload.writeUInt32BE(i)
    ws.send(Buffer.from(payload), { binary: true })
  }
}

function collect (ws) {
  const received = []
  ws.on('message', (data) => {
    received.push(data.length === MESSAGE_SIZE ? data.readUInt32BE() : -1)
  })
  return received
}

const inOrder = Array.from({ length: MESSAGES }, (_, i) => i)

for (const wsReconnect of [undefined, { pingInterval: 60_000 }]) {
  const suffix = wsReconnect ? ' (with reconnection)' : ''

  test(`pauses the client when the target is slow${suffix}`, async (t) => {
    let targetSide
    let received
    const { client, link } = await setup(t, {
      wsHighWaterMark: MESSAGE_SIZE,
      wsReconnect,
      onTargetConnection (ws) {
        targetSide = ws
        received = collect(ws)
        ws.pause()
      }
    })
    await until(() => link.source && targetSide, 'link')

    sendAll(client)

    await until(() => link.source.isPaused, 'source to be paused')
    await wait(200)
    t.assert.ok(link.source.isPaused, 'source stays paused while the target does not read')
    t.assert.ok(link.incoming < MESSAGES, `proxy read ${link.incoming} of ${MESSAGES} messages`)

    targetSide.resume()

    await until(() => received.length === MESSAGES, 'all messages to reach the target')
    t.assert.deepStrictEqual(received, inOrder)
    await until(() => !link.source.isPaused, 'source to be resumed')
  })

  test(`pauses the target when the client is slow${suffix}`, async (t) => {
    let targetSide
    const { client, link } = await setup(t, {
      wsHighWaterMark: MESSAGE_SIZE,
      wsReconnect,
      onTargetConnection (ws) { targetSide = ws }
    })
    await until(() => link.target && targetSide, 'link')
    const received = collect(client)
    client.pause()

    sendAll(targetSide)

    await until(() => link.target.isPaused, 'target to be paused')
    await wait(200)
    t.assert.ok(link.target.isPaused, 'target stays paused while the client does not read')
    t.assert.ok(link.outgoing < MESSAGES, `proxy read ${link.outgoing} of ${MESSAGES} messages`)

    client.resume()

    await until(() => received.length === MESSAGES, 'all messages to reach the client')
    t.assert.deepStrictEqual(received, inOrder)
    await until(() => !link.target.isPaused, 'target to be resumed')
  })

  test(`resumes a paused client when the link is closed${suffix}`, async (t) => {
    let targetSide
    const { client, link } = await setup(t, {
      wsHighWaterMark: MESSAGE_SIZE,
      wsReconnect,
      onTargetConnection (ws) {
        targetSide = ws
        ws.pause()
      }
    })
    await until(() => link.source && targetSide, 'link')

    sendAll(client)
    await until(() => link.source.isPaused, 'source to be paused')

    targetSide.terminate()

    await once(client, 'close')
    t.assert.strictEqual(link.source.isPaused, false)
  })
}

test('does not pause when wsHighWaterMark is Infinity', async (t) => {
  let targetSide
  let received
  const { client, link } = await setup(t, {
    wsHighWaterMark: Infinity,
    onTargetConnection (ws) {
      targetSide = ws
      received = collect(ws)
      ws.pause()
    }
  })
  await until(() => link.source && targetSide, 'link')

  sendAll(client)

  await until(() => link.incoming === MESSAGES, 'the proxy to buffer every message')
  t.assert.strictEqual(link.source.isPaused, false)

  targetSide.resume()
  await until(() => received.length === MESSAGES, 'all messages to reach the target')
  t.assert.deepStrictEqual(received, inOrder)
})

// An upstream that accepts the TCP connection but holds the handshake until
// `handshake` settles: it completes when resolved with true, and the socket is
// destroyed otherwise.
async function setupSlowHandshake (t) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ noServer: true })
  const state = { incoming: 0 }
  const handshake = new Promise(resolve => { state.settle = resolve })
  targetServer.on('upgrade', async (request, socket, head) => {
    if (await handshake) {
      targetWs.handleUpgrade(request, socket, head, (ws) => { state.received = collect(ws) })
    } else {
      socket.destroy()
    }
  })
  await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

  const proxy = Fastify()
  proxy.register(proxyPlugin, {
    upstream: `ws://127.0.0.1:${targetServer.address().port}`,
    websocket: true,
    wsHighWaterMark: MESSAGE_SIZE,
    wsHooks: {
      onIncomingMessage (_context, source) {
        state.source = source
        state.incoming++
      }
    }
  })
  await proxy.listen({ port: 0, host: '127.0.0.1' })

  state.client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
  state.client.on('error', () => {})
  await once(state.client, 'open')
  t.after(async () => {
    state.client.terminate()
    targetWs.close()
    targetServer.close()
    await proxy.close()
  })

  return state
}

test('applies backpressure while the target is still connecting', async (t) => {
  const state = await setupSlowHandshake(t)

  sendAll(state.client)

  await until(() => state.source?.isPaused, 'source to be paused')
  await wait(200)
  t.assert.ok(state.incoming < MESSAGES, `proxy read ${state.incoming} of ${MESSAGES} messages`)

  state.settle(true)

  await until(() => state.received?.length === MESSAGES, 'all messages to reach the target')
  t.assert.deepStrictEqual(state.received, inOrder)
})

test('resumes a paused client when the target fails to connect', async (t) => {
  const state = await setupSlowHandshake(t)

  sendAll(state.client)
  await until(() => state.source?.isPaused, 'source to be paused')

  state.settle(false)

  await once(state.client, 'close')
  t.assert.strictEqual(state.source.isPaused, false)
})

test('does not reconnect a target paused for longer than the ping interval', async (t) => {
  let targetSide
  let connections = 0
  const { client, link } = await setup(t, {
    wsHighWaterMark: MESSAGE_SIZE,
    wsReconnect: { pingInterval: 100, reconnectInterval: 100 },
    onTargetConnection (ws) {
      connections++
      targetSide = ws
    }
  })
  await until(() => link.target && targetSide, 'link')
  const received = collect(client)
  client.pause()

  sendAll(targetSide)

  await until(() => link.target.isPaused, 'target to be paused')
  // several ping intervals without the proxy reading any pong
  await wait(500)
  t.assert.ok(link.target.isPaused)
  t.assert.strictEqual(link.target.readyState, WebSocket.OPEN)

  client.resume()

  await until(() => received.length === MESSAGES, 'all messages to reach the client')
  t.assert.deepStrictEqual(received, inOrder)
  // the heartbeat keeps working once the target is read again
  await wait(300)
  t.assert.strictEqual(link.target.readyState, WebSocket.OPEN)
  t.assert.strictEqual(connections, 1)
})

for (const wsReconnect of [undefined, { pingInterval: 60_000 }]) {
  const suffix = wsReconnect ? ' (with reconnection)' : ''

  test(`answers pings itself and relays none when wsForwardPings is false${suffix}`, async (t) => {
    let targetSide
    const events = []
    const { client, link } = await setup(t, {
      wsForwardPings: false,
      wsReconnect,
      onTargetConnection (ws) {
        targetSide = ws
        ws.on('ping', (data) => events.push(`target ping ${data}`))
        ws.on('pong', (data) => events.push(`target pong ${data}`))
      }
    })
    await until(() => link.target && targetSide, 'link')
    client.on('ping', (data) => events.push(`client ping ${data}`))
    client.on('pong', (data) => events.push(`client pong ${data}`))

    client.ping('from-client')
    targetSide.ping('from-target')
    // an unsolicited pong is not relayed either
    client.pong('unsolicited')

    await until(() => events.length >= 2, 'pongs')
    await wait(200)
    t.assert.deepStrictEqual(events.sort(), ['client pong from-client', 'target pong from-target'])

    // messages still flow
    targetSide.once('message', (data, binary) => targetSide.send(data, { binary }))
    client.send('hello')
    const [reply] = await once(client, 'message')
    t.assert.strictEqual(reply.toString(), 'hello')
  })
}

test('relays pings end to end by default', async (t) => {
  let targetSide
  const events = []
  const { client, link } = await setup(t, {
    onTargetConnection (ws) {
      targetSide = ws
      ws.on('ping', (data) => events.push(`target ping ${data}`))
    }
  })
  await until(() => link.target && targetSide, 'link')
  client.on('ping', (data) => events.push(`client ping ${data}`))

  client.ping('from-client')
  targetSide.ping('from-target')

  await until(() => events.length === 2, 'pings')
  t.assert.deepStrictEqual(events.sort(), ['client ping from-target', 'target ping from-client'])
})

test('keeps answering the pings of a slow client while the target is paused', async (t) => {
  let targetSide
  const events = []
  const { client, link } = await setup(t, {
    wsHighWaterMark: MESSAGE_SIZE,
    wsForwardPings: false,
    onTargetConnection (ws) {
      targetSide = ws
      ws.on('ping', (data) => events.push(`target ping ${data}`))
    }
  })
  await until(() => link.target && targetSide, 'link')

  // a client that keeps reading, but slower than the target writes
  let received = 0
  client.on('message', () => {
    received++
    client.pause()
    setTimeout(() => client.resume(), 5)
  })
  let pong
  client.on('pong', (data) => {
    pong = { data: data.toString(), received, targetPaused: link.target.isPaused }
  })

  sendAll(targetSide)
  await until(() => link.target.isPaused, 'target to be paused')

  client.ping('still-there')

  await until(() => pong, 'pong')
  t.assert.strictEqual(pong.data, 'still-there')
  t.assert.ok(pong.targetPaused, 'answered while the target is paused')
  t.assert.ok(pong.received < MESSAGES, `answered after ${pong.received} of ${MESSAGES} messages`)

  await until(() => received === MESSAGES, 'all messages to reach the client')
  t.assert.deepStrictEqual(events, [])
})

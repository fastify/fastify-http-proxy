'use strict'

// These tests do not rely on timers: every step waits for an event caused by
// the previous one. That the proxy holds messages back is checked through the
// peak of what it had queued, and that something was NOT relayed by sending a
// marker through the proxy afterwards, since frames are delivered in order.

const { test } = require('node:test')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once, EventEmitter } = require('node:events')
const Fastify = require('fastify')
const WebSocket = require('ws')
const proxyPlugin = require('../')

const MESSAGE_SIZE = 256 * 1024
const MESSAGES = 128 // 32 MiB overall, far more than the kernel buffers can absorb
const inOrder = Array.from({ length: MESSAGES }, (_, i) => i)
// Once a socket is paused, the messages it had already read are still emitted.
const MAX_BACKLOG = 4 * MESSAGE_SIZE

// Resolves as soon as `predicate` holds, checking it again on each `event`.
async function when (emitter, event, predicate) {
  while (!predicate()) {
    await once(emitter, event)
  }
}

// Makes the pause()/resume() calls of the proxy observable as events.
function observePauses (ws) {
  if (ws.observed) {
    return
  }
  ws.observed = true
  const { pause, resume } = ws
  ws.pause = function () {
    pause.call(this)
    this.emit('test:paused')
  }
  ws.resume = function () {
    resume.call(this)
    this.emit('test:resumed')
  }
}

async function paused (ws) {
  await when(ws, 'test:paused', () => ws.isPaused)
}

async function resumed (ws) {
  await when(ws, 'test:resumed', () => !ws.isPaused)
}

function sendAll (ws) {
  const payload = Buffer.alloc(MESSAGE_SIZE, 'a')
  for (let i = 0; i < MESSAGES; i++) {
    payload.writeUInt32BE(i)
    ws.send(Buffer.from(payload), { binary: true })
  }
}

// Records the sequence numbers of the messages sent by sendAll(). Any other
// message is a marker, reported through the 'marker' event.
function collect (ws) {
  const received = []
  ws.on('message', (data) => {
    if (data.length === MESSAGE_SIZE) {
      received.push(data.readUInt32BE())
      ws.emit('test:received')
    } else {
      ws.emit('test:marker', data.toString())
    }
  })
  // not enumerable, so that the array still compares equal to `inOrder`
  Object.defineProperty(received, 'complete', {
    value: () => when(ws, 'test:received', () => received.length === MESSAGES)
  })
  return received
}

async function setup (t, { wsHighWaterMark, wsBackpressureTimeout, wsReconnect, wsForwardPings, onPong, onDisconnect, onTargetConnection }) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ server: targetServer })
  targetWs.on('connection', onTargetConnection)
  await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

  const link = new EventEmitter()
  link.incoming = 0
  link.targetBacklog = 0
  link.sourceBacklog = 0
  const proxy = Fastify()
  proxy.register(proxyPlugin, {
    upstream: `ws://127.0.0.1:${targetServer.address().port}`,
    websocket: true,
    wsHighWaterMark,
    wsBackpressureTimeout,
    wsReconnect,
    wsForwardPings,
    wsHooks: {
      onDisconnect,
      onConnect (_context, source, target) {
        observePauses(source)
        observePauses(target)
        link.source = source
        link.target = target
        link.emit('connect')
      },
      // peak of what the proxy has queued for each side
      onIncomingMessage (_context, _source, target) {
        link.incoming++
        link.targetBacklog = Math.max(link.targetBacklog, target.bufferedAmount)
        link.emit('incoming')
      },
      onOutgoingMessage (_context, source) {
        link.sourceBacklog = Math.max(link.sourceBacklog, source.bufferedAmount)
      },
      onPong
    }
  })
  await proxy.listen({ port: 0, host: '127.0.0.1' })

  const connected = once(link, 'connect')
  const client = new WebSocket(`ws://127.0.0.1:${proxy.server.address().port}`)
  client.on('error', () => {})
  await Promise.all([once(client, 'open'), connected])

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

    sendAll(client)
    await paused(link.source)
    t.assert.ok(link.incoming < MESSAGES, `proxy read ${link.incoming} of ${MESSAGES} messages`)
    t.assert.deepStrictEqual(received, [])

    targetSide.resume()

    await received.complete()
    t.assert.deepStrictEqual(received, inOrder)
    t.assert.ok(link.targetBacklog <= MAX_BACKLOG, `the proxy queued up to ${link.targetBacklog} bytes`)
    await resumed(link.source)
  })

  test(`pauses the target when the client is slow${suffix}`, async (t) => {
    let targetSide
    const { client, link } = await setup(t, {
      wsHighWaterMark: MESSAGE_SIZE,
      wsReconnect,
      onTargetConnection (ws) { targetSide = ws }
    })
    const received = collect(client)
    client.pause()

    sendAll(targetSide)
    await paused(link.target)
    t.assert.deepStrictEqual(received, [])

    client.resume()

    await received.complete()
    t.assert.deepStrictEqual(received, inOrder)
    t.assert.ok(link.sourceBacklog <= MAX_BACKLOG, `the proxy queued up to ${link.sourceBacklog} bytes`)
    await resumed(link.target)
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

    sendAll(client)
    await paused(link.source)

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
  link.source.on('test:paused', () => t.assert.fail('source must not be paused'))

  sendAll(client)

  // the proxy buffers every message while the target reads none
  await when(link, 'incoming', () => link.incoming === MESSAGES)
  t.assert.deepStrictEqual(received, [])

  targetSide.resume()
  await received.complete()
  t.assert.deepStrictEqual(received, inOrder)
})

// An upstream that accepts the TCP connection but holds the handshake until
// `settle` is called: it completes with true, the socket is destroyed otherwise.
async function setupSlowHandshake (t) {
  const targetServer = createServer()
  const targetWs = new WebSocket.Server({ noServer: true })
  const state = new EventEmitter()
  state.incoming = 0
  const handshake = new Promise(resolve => { state.settle = resolve })
  targetServer.on('upgrade', async (request, socket, head) => {
    if (await handshake) {
      targetWs.handleUpgrade(request, socket, head, (ws) => {
        state.received = collect(ws)
        state.emit('target')
      })
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
      // onConnect only runs once the target is open: the first message is the
      // earliest point where the source is reachable, before it is forwarded.
      onIncomingMessage (_context, source) {
        observePauses(source)
        state.source = source
        state.incoming++
        state.emit('incoming')
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

  await once(state, 'incoming')
  await paused(state.source)
  t.assert.ok(state.incoming < MESSAGES, `proxy read ${state.incoming} of ${MESSAGES} messages`)

  state.settle(true)

  await once(state, 'target')
  await state.received.complete()
  t.assert.deepStrictEqual(state.received, inOrder)
})

test('resumes a paused client when the target fails to connect', async (t) => {
  const state = await setupSlowHandshake(t)

  sendAll(state.client)
  await once(state, 'incoming')
  await paused(state.source)

  state.settle(false)

  await once(state.client, 'close')
  t.assert.strictEqual(state.source.isPaused, false)
})

test('does not reconnect a target paused for longer than the ping interval', async (t) => {
  // The heartbeat is driven by hand: each tick() is one ping interval.
  t.mock.timers.enable({ apis: ['setInterval'] })
  const pingInterval = 1000
  const pongs = new EventEmitter()

  let targetSide
  let connections = 0
  const { client, link } = await setup(t, {
    wsHighWaterMark: MESSAGE_SIZE,
    wsReconnect: { pingInterval, reconnectInterval: 100 },
    onPong () { pongs.emit('pong') },
    onTargetConnection (ws) {
      connections++
      targetSide = ws
    }
  })
  const received = collect(client)

  // one healthy heartbeat before any pressure
  let pong = once(pongs, 'pong')
  t.mock.timers.tick(pingInterval)
  await pong

  // a ping goes out right before the target gets paused: its pong is not read
  t.mock.timers.tick(pingInterval)
  client.pause()
  sendAll(targetSide)
  await paused(link.target)

  // several intervals elapse without the proxy reading any pong
  for (let i = 0; i < 5; i++) {
    await paused(link.target)
    t.mock.timers.tick(pingInterval)
    t.assert.strictEqual(link.target.readyState, WebSocket.OPEN)
  }

  client.resume()
  await received.complete()
  t.assert.deepStrictEqual(received, inOrder)
  await resumed(link.target)

  // the heartbeat works again once the target is read
  pong = once(pongs, 'pong')
  t.mock.timers.tick(pingInterval)
  await pong
  t.mock.timers.tick(pingInterval)
  t.assert.strictEqual(link.target.readyState, WebSocket.OPEN)
  t.assert.strictEqual(connections, 1)
})

for (const wsReconnect of [undefined, { pingInterval: 60_000 }]) {
  const suffix = wsReconnect ? ' (with reconnection)' : ''

  test(`answers pings itself and relays none when wsForwardPings is false${suffix}`, async (t) => {
    let targetSide
    const events = []
    const { client } = await setup(t, {
      wsForwardPings: false,
      wsReconnect,
      onTargetConnection (ws) {
        targetSide = ws
        ws.on('ping', (data) => events.push(`target ping ${data}`))
        ws.on('pong', (data) => events.push(`target pong ${data}`))
        // echo
        ws.on('message', (data, binary) => ws.send(data, { binary }))
      }
    })
    client.on('ping', (data) => events.push(`client ping ${data}`))
    client.on('pong', (data) => events.push(`client pong ${data}`))

    const targetPong = once(targetSide, 'pong')
    targetSide.ping('from-target')
    await targetPong

    client.ping('from-client')
    // an unsolicited pong is not relayed either
    client.pong('unsolicited')

    // Frames are delivered in order: anything relayed in either direction
    // would reach its destination before this echo completes.
    const echo = once(client, 'message')
    client.send('hello')
    const [reply] = await echo
    t.assert.strictEqual(reply.toString(), 'hello')

    t.assert.deepStrictEqual(events, ['target pong from-target', 'client pong from-client'])
  })
}

test('relays pings end to end by default', async (t) => {
  let targetSide
  const { client } = await setup(t, {
    onTargetConnection (ws) { targetSide = ws }
  })

  const targetPing = once(targetSide, 'ping')
  const clientPing = once(client, 'ping')
  client.ping('from-client')
  targetSide.ping('from-target')

  t.assert.strictEqual((await targetPing)[0].toString(), 'from-client')
  t.assert.strictEqual((await clientPing)[0].toString(), 'from-target')
})

test('keeps answering the pings of a slow client while the target is paused', async (t) => {
  let targetSide
  const targetPings = []
  const { client, link } = await setup(t, {
    wsHighWaterMark: MESSAGE_SIZE,
    wsForwardPings: false,
    onTargetConnection (ws) {
      targetSide = ws
      ws.on('ping', (data) => targetPings.push(data.toString()))
      // echo
      ws.on('message', (data, binary) => ws.send(data, { binary }))
    }
  })
  const received = collect(client)
  client.pause()

  sendAll(targetSide)
  await paused(link.target)

  // The target is paused, the client pings: the proxy answers on its own. The
  // pong comes after the messages already queued for the client, but well
  // before the rest of the backlog held back in the target.
  const pong = once(client, 'pong')
  client.ping('still-there')
  client.resume()
  const [data] = await pong
  t.assert.strictEqual(data.toString(), 'still-there')
  t.assert.ok(received.length < MESSAGES, `answered after ${received.length} of ${MESSAGES} messages`)

  await received.complete()
  t.assert.deepStrictEqual(received, inOrder)

  // the echo is ordered after anything the proxy would have relayed
  const marker = once(client, 'test:marker')
  client.send('marker')
  await marker
  t.assert.deepStrictEqual(targetPings, [])
})

for (const wsReconnect of [undefined, { pingInterval: 60_000, reconnectOnClose: true }]) {
  const suffix = wsReconnect ? ' (with reconnection)' : ''

  test(`terminates a link stalled for longer than wsBackpressureTimeout${suffix}`, async (t) => {
    // The timeout is driven by hand.
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const wsBackpressureTimeout = 5000

    let connections = 0
    let disconnects = 0
    const { client, link } = await setup(t, {
      wsHighWaterMark: MESSAGE_SIZE,
      wsBackpressureTimeout,
      wsReconnect,
      onDisconnect () { disconnects++ },
      onTargetConnection (ws) {
        connections++
        // an upstream that accepts the connection and never reads
        ws.pause()
      }
    })
    const clientClosed = once(client, 'close')
    const sourceClosed = once(link.source, 'close')
    const targetClosed = once(link.target, 'close')

    sendAll(client)
    await paused(link.source)

    // nothing runs between these ticks, so nothing can be flushed meanwhile
    t.mock.timers.tick(wsBackpressureTimeout - 1)
    t.assert.strictEqual(link.source.readyState, WebSocket.OPEN)
    t.assert.strictEqual(link.target.readyState, WebSocket.OPEN)
    t.mock.timers.tick(1)

    await Promise.all([clientClosed, sourceClosed, targetClosed])
    t.assert.strictEqual(disconnects, 1)
    t.assert.strictEqual(connections, 1, 'a stalled link is not reconnected')
  })
}

test('a link that keeps flushing does not time out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const wsBackpressureTimeout = 5000
  const count = 50

  const targetMessages = new EventEmitter()
  const received = []
  const { client, link } = await setup(t, {
    // every message is over the mark: the source stays paused until the last
    // one of a burst is flushed, each flush restarting the timeout
    wsHighWaterMark: 1,
    wsBackpressureTimeout,
    onTargetConnection (ws) {
      ws.on('message', (data) => {
        received.push(data.toString())
        targetMessages.emit('message')
      })
    }
  })
  let pauses = 0
  link.source.on('test:paused', () => pauses++)

  // a single write, so that the proxy reads the whole burst at once
  client._socket.cork()
  for (let i = 0; i < count; i++) {
    client.send(`message-${i}`)
  }
  client._socket.uncork()

  await when(targetMessages, 'message', () => received.length === count)
  t.assert.deepStrictEqual(received, Array.from({ length: count }, (_, i) => `message-${i}`))
  t.assert.ok(pauses > 0, 'the source has been paused')

  // once resumed, the timeout is disarmed
  await resumed(link.source)
  t.mock.timers.tick(wsBackpressureTimeout)
  t.assert.strictEqual(link.source.readyState, WebSocket.OPEN)
  t.assert.strictEqual(link.target.readyState, WebSocket.OPEN)
})

test('does not time out when wsBackpressureTimeout is Infinity', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  let targetSide
  let received
  const { client, link } = await setup(t, {
    wsHighWaterMark: MESSAGE_SIZE,
    wsBackpressureTimeout: Infinity,
    onTargetConnection (ws) {
      targetSide = ws
      received = collect(ws)
      ws.pause()
    }
  })

  sendAll(client)
  await paused(link.source)
  t.mock.timers.tick(24 * 60 * 60 * 1000)
  t.assert.strictEqual(link.source.readyState, WebSocket.OPEN)

  targetSide.resume()
  await received.complete()
  t.assert.deepStrictEqual(received, inOrder)
})

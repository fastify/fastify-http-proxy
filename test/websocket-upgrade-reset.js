'use strict'

// Regression tests for GHSA-Q659-79J2-32H5.
//
// With websocket: true the plugin takes every upgraded socket and dispatches
// the request through the Fastify router. Node removes its own 'error' listener
// from the socket before emitting 'upgrade', and `ws` only installs its own
// listener once the route handler calls wss.handleUpgrade() -- after any hooks
// have run. A TCP reset (ECONNRESET) arriving while an async hook is still
// pending was therefore unhandled and crashed the process.
//
// The proxy runs in a forked subprocess so that, should this ever regress, the
// crash is contained and reported rather than taking down the test runner.

const { test } = require('node:test')
const assert = require('node:assert')
const { fork } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')

const SERVER = path.join(__dirname, 'helper', 'upgrade-reset-server.js')

function handshake (target) {
  return [
    `GET ${target} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '', ''
  ].join('\r\n')
}

// Sends an upgrade request and, 30 ms later, resets the TCP connection.
function upgradeThenReset (port, target) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(handshake(target))
      setTimeout(() => {
        socket.resetAndDestroy()
        resolve()
      }, 30)
    })
    socket.on('error', () => resolve())
  })
}

function spawnProxyServer (t, mode) {
  const child = fork(SERVER, [mode], { stdio: ['ignore', 'inherit', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  // Exit gracefully (not SIGTERM) so the child flushes its V8 coverage.
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.disconnect()
      await exited
    }
  })
  return { child, stderr: () => stderr }
}

test('a TCP reset during WebSocket upgrade dispatch does not crash the process (async hook)', async (t) => {
  const { child, stderr } = spawnProxyServer(t, 'async-hook')
  const [msg] = await once(child, 'message')
  const port = msg.port

  await upgradeThenReset(port, '/pub/echo')

  // Give the async hook time to run to completion so that any post-reset
  // continuation on the destroyed socket has a chance to surface.
  await sleep(500)

  assert.strictEqual(child.exitCode, null, `proxy process crashed:\n${stderr()}`)
})

test('a TCP reset during WebSocket upgrade dispatch does not crash the process (async route)', async (t) => {
  const { child, stderr } = spawnProxyServer(t, 'async-route')
  const [msg] = await once(child, 'message')
  const port = msg.port

  await upgradeThenReset(port, '/report')

  await sleep(500)

  assert.strictEqual(child.exitCode, null, `proxy process crashed:\n${stderr()}`)
})

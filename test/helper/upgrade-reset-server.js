'use strict'

// Server subprocess for the GHSA-Q659-79J2-32H5 regression tests.
//
// It runs a WebSocket proxy in its own process and reports the bound port over
// IPC. The parent test process can then open an upgrade request and reset the
// TCP connection, and assert that this subprocess has not crashed. If a reset
// were to take down the process, the crash would be contained here rather than
// killing the whole test runner.
//
// This file is not itself a test: it is forked by test/websocket-upgrade-reset.js
// with a mode argument. The server only boots when a mode is supplied, so that
// borp (which globs every file under test/) can load this module harmlessly.

const { createServer } = require('node:http')
const { WebSocketServer } = require('ws')
const Fastify = require('fastify')
const proxy = require('../../')
const { setTimeout: sleep } = require('node:timers/promises')

const mode = process.argv[2] // 'async-hook' | 'async-route' | 'no-hook'
if (!mode) {
  // Loaded by the test runner rather than forked: nothing to do.
  module.exports = {}
} else {
  const origin = createServer()
  const wss = new WebSocketServer({ server: origin })
  wss.on('connection', (ws) => ws.on('message', (data, binary) => ws.send(data, { binary })))
  origin.listen(0, '127.0.0.1', async () => {
    const app = Fastify()
    const options = {
      upstream: `ws://127.0.0.1:${origin.address().port}`,
      prefix: '/pub',
      websocket: true
    }
    if (mode === 'async-hook') {
      // stand-in for an async auth / session / rate-limit lookup
      options.preHandler = async () => { await sleep(150) }
    }
    app.register(proxy, options)
    if (mode === 'async-route') {
      // No hook on the proxy: an unrelated, ordinary async route of the same
      // application. While the proxy is the only 'upgrade' listener it routes
      // every upgrade request, so an upgrade to /report runs this handler on the
      // same unguarded socket.
      app.get('/report', async () => { await sleep(150); return { ok: true } })
    }

    await app.listen({ port: 0, host: '127.0.0.1' })
    process.on('disconnect', () => process.exit(0))
    process.send({ port: app.server.address().port })
  })
}

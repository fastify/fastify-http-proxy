'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const proxyPlugin = require('../')
const WebSocket = require('ws')
const { createServer } = require('node:http')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { setTimeout } = require('node:timers/promises')

async function createServices({ t, wsReconnectOptions, wsTargetOptions, wsServerOptions }) {
    const targetServer = createServer()
    const targetWs = new WebSocket.Server({ server: targetServer, ...wsTargetOptions })

    await promisify(targetServer.listen.bind(targetServer))({ port: 0, host: '127.0.0.1' })

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

//   const { target } = await createServices({t, wsReconnectOptions})

//   let counter = 0
//   target.ws.on('connection', function connection (ws) {
//     ws.on('pong', (data) => {
//       console.log(' *** pong', data)
//       counter++
//     })
//   })

//   await setTimeout(250)

//   t.ok(counter > 1)
// })

test('should reconnect on broken connection', async (t) => {
    const wsReconnectOptions = { pingInterval: 250 }

    const { target } = await createServices({ t, wsReconnectOptions, wsTargetOptions: { autoPong: false } })

    let counter = 0
    target.ws.on('connection', function connection(ws) {
        console.log(' *** connection')

        ws.on('message', async (data) => {
            await setTimeout(1000)
            console.log(' +++ message', data)
        })

        ws.on('ping', (data) => {
            console.log(' *** ping', data)
        })

        ws.on('pong', async (data) => {
            console.log(' *** pong', data)
            await setTimeout(1000)
            counter++
        })
    })

    await setTimeout(2000)

    t.ok(counter > 1)
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

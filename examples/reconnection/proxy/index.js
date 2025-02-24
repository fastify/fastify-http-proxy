'use strict'

const { setTimeout: wait } = require('node:timers/promises')
const fastify = require('fastify')
const fastifyHttpProxy = require('../../../')

async function main () {
  const port = process.env.PORT || 3001

  const wsReconnect = {
    logs: true,
    pingInterval: 3_000,
    reconnectOnClose: true,
  }

  let backup = []
  let lastPong = Date.now()

  // resend messages from last ping
  // it may send messages more than once
  // in case the target already received messages between last ping and the reconnection
  async function resendMessages (target) {
    const now = Date.now()

    for (const m of backup) {
      if (m.timestamp < lastPong || m.timestamp > now) {
        continue
      }
      console.log(' >>> resending message #', m)
      target.send(m.message)
      // introduce a small delay to avoid to flood the target
      await wait(250)
    }
  };

  const wsHooks = {
    onPong: () => {
      console.log('onPong')
      lastPong = Date.now()
      // clean backup from the last ping
      backup = backup.filter(message => message.timestamp > lastPong)
    },
    onIncomingMessage: (context, source, target, message) => {
      const m = message.data.toString()
      console.log('onIncomingMessage backup', m)
      backup.push({ message: m, timestamp: Date.now() })
    },
    onDisconnect: () => {
      console.log('onDisconnect')
      backup.length = 0
    },
    onReconnect: (context, source, target) => {
      console.log('onReconnect')
      resendMessages(target)
    },
  }

  const proxy = fastify({ logger: true })
  proxy.register(fastifyHttpProxy, {
    upstream: 'http://localhost:3000/',
    websocket: true,
    wsUpstream: 'ws://localhost:3000/',
    wsReconnect,
    wsHooks,
  })

  await proxy.listen({ port })
}

main()

'use strict'

const { setTimeout: wait } = require('node:timers/promises')
const fastify = require('fastify')

// unstable service

async function main () {
  const SLOW_START = process.env.SLOW_START || 2_000
  const UNSTABLE_MIN = process.env.UNSTABLE_MIN || 1_000
  const UNSTABLE_MAX = process.env.UNSTABLE_MAX || 10_000
  const BLOCK_TIME = process.env.BLOCK_TIME || 5_000

  const app = fastify({ logger: true })

  // slow start

  await wait(SLOW_START)

  app.register(require('@fastify/websocket'))
  app.register(async function (app) {
    app.get('/', { websocket: true }, (socket) => {
      socket.on('message', message => {
        let m = message.toString()
        console.log('incoming message', m)
        m = JSON.parse(m)

        socket.send(JSON.stringify({
          response: m.message
        }))
      })
    })
  })

  try {
    const port = process.env.PORT || 3000
    await app.listen({ port })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  if (process.env.STABLE) {
    return
  }

  function runProblem () {
    const problem = process.env.PROBLEM || (Math.random() < 0.5 ? 'crash' : 'block')
    const unstabilityTimeout = process.env.UNSTABLE_TIMEOUT || Math.round(UNSTABLE_MIN + Math.random() * (UNSTABLE_MAX - UNSTABLE_MIN))

    if (problem === 'crash') {
      console.log(`Restarting (crash and restart) in ${unstabilityTimeout}ms`)
      setTimeout(() => {
        console.log('UNHANDLED EXCEPTION')
        throw new Error('UNHANDLED EXCEPTION')
      }, unstabilityTimeout).unref()
    } else {
      console.log(`Blocking EL in ${unstabilityTimeout}ms for ${BLOCK_TIME}ms`)

      setTimeout(() => {
        console.log('Block EL ...')
        const start = performance.now()
        while (performance.now() - start < BLOCK_TIME) {
          // just block
        }
        console.log('Block ends')
        runProblem()
      }, unstabilityTimeout).unref()
    }
  }

  runProblem()
}

main()

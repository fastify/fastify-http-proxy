'use strict'

const { test } = require('tap')
const { validateOptions } = require('../src/options')

test('validateOptions', (t) => {
  const requiredOptions = {
    upstream: 'someUpstream'
  }

  t.throws(() => validateOptions({}), 'throws error if neither upstream nor websocket is specified')
  t.doesNotThrow(() => validateOptions({ upstream: 'someUpstream' }))
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: -1 } }), 'wsReconnect.pingInterval must be a non-negative number')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.pingInterval, 30_000, 'sets default pingInterval if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectAttempts: -1 } }), 'wsReconnect.maxReconnectAttempts must be a non-negative number')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.maxReconnectAttempts, 3, 'sets default maxReconnectAttempts if not specified')
  }

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.maxReconnectionRetries, Infinity, 'sets default maxReconnectionRetries if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: -1 } }), 'wsReconnect.reconnectInterval must be a non-negative number')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.reconnectInterval, 1_000, 'sets default reconnectInterval if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: 0.5 } }), 'wsReconnect.reconnectDecay must be a number greater than or equal to 1')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.reconnectDecay, 1.5, 'sets default reconnectDecay if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: -1 } }), 'wsReconnect.connectionTimeout must be a non-negative number')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.connectionTimeout, 5_000, 'sets default connectionTimeout if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectOnClose: 'notBoolean' } }), 'wsReconnect.reconnectOnClose must be a boolean')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.reconnectOnClose, false, 'sets default reconnectOnClose if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: 0.5 } }), 'wsReconnect.reconnectDecay must be a number greater than or equal to 1')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.reconnectDecay, 1.5, 'sets default reconnectDecay if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: -1 } }), 'wsReconnect.connectionTimeout must be a non-negative number')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.connectionTimeout, 5_000, 'sets default connectionTimeout if not specified')
  }

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectOnClose: 'notBoolean' } }), 'wsReconnect.reconnectOnClose must be a boolean')

  {
    const options = { ...requiredOptions, wsReconnect: {} }
    validateOptions(options)
    t.equal(options.wsReconnect.reconnectOnClose, false, 'sets default reconnectOnClose if not specified')
  }

  t.end()
})

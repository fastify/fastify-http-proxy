'use strict'

const { test } = require('tap')
const { validateOptions } = require('../src/options')
const { DEFAULT_PING_INTERVAL, DEFAULT_MAX_RECONNECTION_RETRIES, DEFAULT_RECONNECT_INTERVAL, DEFAULT_RECONNECT_DECAY, DEFAULT_CONNECTION_TIMEOUT, DEFAULT_RECONNECT_ON_CLOSE } = require('../src/options')
test('validateOptions', (t) => {
  const requiredOptions = {
    upstream: 'someUpstream'
  }

  t.throws(() => validateOptions({}), 'upstream must be specified')

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: -1 } }), 'wsReconnect.pingInterval must be a non-negative number')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: '1' } }), 'wsReconnect.pingInterval must be a non-negative number')
  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: 1 } }))

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: 0 } }), 'wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: -1 } }), 'wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: '1' } }), 'wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1')
  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: 1 } }))

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: 0 } }), 'wsReconnect.reconnectInterval (ms) must be a number greater than or equal to 100')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: -1 } }), 'wsReconnect.reconnectInterval (ms) must be a number greater than or equal to 100')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: '1' } }), 'wsReconnect.reconnectInterval (ms) must be a number greater than or equal to 100')
  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: 100 } }))

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: 0 } }), 'wsReconnect.reconnectDecay must be a number greater than or equal to 1')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: -1 } }), 'wsReconnect.reconnectDecay must be a number greater than or equal to 1')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: '1' } }), 'wsReconnect.reconnectDecay must be a number greater than or equal to 1')
  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: 1 } }))

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: -1 } }), 'wsReconnect.connectionTimeout must be a non-negative number')
  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: '1' } }), 'wsReconnect.connectionTimeout must be a non-negative number')
  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: 1 } }))

  t.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectOnClose: '1' } }), 'wsReconnect.reconnectOnClose must be a boolean')
  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectOnClose: true } }))

  t.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: 1, maxReconnectionRetries: 1, reconnectInterval: 100, reconnectDecay: 1, connectionTimeout: 1, reconnectOnClose: true } }))

  t.equal(validateOptions({ ...requiredOptions, wsReconnect: { } }), {
    ...requiredOptions,
    wsReconnect: {
      pingInterval: DEFAULT_PING_INTERVAL,
      maxReconnectionRetries: DEFAULT_MAX_RECONNECTION_RETRIES,
      reconnectInterval: DEFAULT_RECONNECT_INTERVAL,
      reconnectDecay: DEFAULT_RECONNECT_DECAY,
      connectionTimeout: DEFAULT_CONNECTION_TIMEOUT,
      reconnectOnClose: DEFAULT_RECONNECT_ON_CLOSE
    }
  })

  t.end()
})

'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { validateOptions } = require('../src/options')
const {
  DEFAULT_PING_INTERVAL, DEFAULT_MAX_RECONNECTION_RETRIES, DEFAULT_RECONNECT_INTERVAL, DEFAULT_RECONNECT_DECAY, DEFAULT_CONNECTION_TIMEOUT, DEFAULT_RECONNECT_ON_CLOSE, DEFAULT_LOGS
} = require('../src/options')

test('validateOptions', (t) => {
  const requiredOptions = {
    upstream: 'someUpstream'
  }

  assert.throws(() => validateOptions({}), /upstream must be specified/)

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: -1 } }), /wsReconnect.pingInterval must be a non-negative number/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: '1' } }), /wsReconnect.pingInterval must be a non-negative number/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { pingInterval: 1 } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: 0 } }), /wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: -1 } }), /wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: '1' } }), /wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { maxReconnectionRetries: 1 } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: 0 } }), /wsReconnect.reconnectInterval \(ms\) must be a number greater than or equal to 100/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: -1 } }), /wsReconnect.reconnectInterval \(ms\) must be a number greater than or equal to 100/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: '1' } }), /wsReconnect.reconnectInterval \(ms\) must be a number greater than or equal to 100/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectInterval: 100 } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: 0 } }), /wsReconnect.reconnectDecay must be a number greater than or equal to 1/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: -1 } }), /wsReconnect.reconnectDecay must be a number greater than or equal to 1/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: '1' } }), /wsReconnect.reconnectDecay must be a number greater than or equal to 1/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectDecay: 1 } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: -1 } }), /wsReconnect.connectionTimeout must be a non-negative number/)
  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: '1' } }), /wsReconnect.connectionTimeout must be a non-negative number/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { connectionTimeout: 1 } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectOnClose: '1' } }), /wsReconnect.reconnectOnClose must be a boolean/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { reconnectOnClose: true } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { logs: '1' } }), /wsReconnect.logs must be a boolean/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { logs: true } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsHooks: { onReconnect: '1' } }), /wsHooks.onReconnect must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsHooks: { onReconnect: () => { } } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsHooks: { onIncomingMessage: '1' } }), /wsHooks.onIncomingMessage must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsHooks: { onIncomingMessage: () => { } } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsHooks: { onOutgoingMessage: '1' } }), /wsHooks.onOutgoingMessage must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsHooks: { onOutgoingMessage: () => { } } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsHooks: { onPong: '1' } }), /wsHooks.onPong must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsHooks: { onPong: () => { } } }))

  // set all values
  assert.doesNotThrow(() => validateOptions({
    ...requiredOptions,
    wsReconnect: {
      pingInterval: 1,
      maxReconnectionRetries: 1,
      reconnectInterval: 100,
      reconnectDecay: 1,
      connectionTimeout: 1,
      reconnectOnClose: true,
      logs: true,
    },
    wsHooks: {
      onReconnect: () => { },
      onIncomingMessage: () => { },
      onOutgoingMessage: () => { },
      onPong: () => { }
    }
  }))

  // get default values
  assert.deepEqual(validateOptions({ ...requiredOptions, wsReconnect: {} }), {
    ...requiredOptions,
    wsReconnect: {
      pingInterval: DEFAULT_PING_INTERVAL,
      maxReconnectionRetries: DEFAULT_MAX_RECONNECTION_RETRIES,
      reconnectInterval: DEFAULT_RECONNECT_INTERVAL,
      reconnectDecay: DEFAULT_RECONNECT_DECAY,
      connectionTimeout: DEFAULT_CONNECTION_TIMEOUT,
      reconnectOnClose: DEFAULT_RECONNECT_ON_CLOSE,
      logs: DEFAULT_LOGS,
    },
    wsHooks: {
      onReconnect: undefined,
      onIncomingMessage: undefined,
      onOutgoingMessage: undefined,
      onPong: undefined,
    }
  })
})

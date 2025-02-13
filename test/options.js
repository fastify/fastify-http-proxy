'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { validateOptions } = require('../src/options')
const {
  DEFAULT_PING_INTERVAL, DEFAULT_MAX_RECONNECTION_RETRIES, DEFAULT_RECONNECT_INTERVAL, DEFAULT_RECONNECT_DECAY, DEFAULT_CONNECTION_TIMEOUT, DEFAULT_RECONNECT_ON_CLOSE, DEFAULT_LOGS,
  DEFAULT_ON_RECONNECT, DEFAULT_ON_TARGET_REQUEST, DEFAULT_ON_TARGET_RESPONSE
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

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { onReconnect: '1' } }), /wsReconnect.onReconnect must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { onReconnect: () => { } } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { onTargetRequest: '1' } }), /wsReconnect.onTargetRequest must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { onTargetRequest: () => { } } }))

  assert.throws(() => validateOptions({ ...requiredOptions, wsReconnect: { onTargetResponse: '1' } }), /wsReconnect.onTargetResponse must be a function/)
  assert.doesNotThrow(() => validateOptions({ ...requiredOptions, wsReconnect: { onTargetResponse: () => { } } }))

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
      onReconnect: () => { },
      onTargetRequest: () => { },
      onTargetResponse: () => { }
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
      onReconnect: DEFAULT_ON_RECONNECT,
      onTargetRequest: DEFAULT_ON_TARGET_REQUEST,
      onTargetResponse: DEFAULT_ON_TARGET_RESPONSE
    }
  })
})

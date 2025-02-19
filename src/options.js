'use strict'

const DEFAULT_PING_INTERVAL = 30_000
const DEFAULT_MAX_RECONNECTION_RETRIES = Infinity
const DEFAULT_RECONNECT_INTERVAL = 1_000
const DEFAULT_RECONNECT_DECAY = 1.5
const DEFAULT_CONNECTION_TIMEOUT = 5_000
const DEFAULT_RECONNECT_ON_CLOSE = false
const DEFAULT_LOGS = false

function validateOptions (options) {
  if (!options.upstream && !options.websocket && !((options.upstream === '' || options.wsUpstream === '') && options.replyOptions && typeof options.replyOptions.getUpstream === 'function')) {
    throw new Error('upstream must be specified')
  }

  if (options.wsReconnect) {
    const wsReconnect = options.wsReconnect

    if (wsReconnect.pingInterval !== undefined && (typeof wsReconnect.pingInterval !== 'number' || wsReconnect.pingInterval < 0)) {
      throw new Error('wsReconnect.pingInterval must be a non-negative number')
    }
    wsReconnect.pingInterval = wsReconnect.pingInterval ?? DEFAULT_PING_INTERVAL

    if (wsReconnect.maxReconnectionRetries !== undefined && (typeof wsReconnect.maxReconnectionRetries !== 'number' || wsReconnect.maxReconnectionRetries < 1)) {
      throw new Error('wsReconnect.maxReconnectionRetries must be a number greater than or equal to 1')
    }
    wsReconnect.maxReconnectionRetries = wsReconnect.maxReconnectionRetries ?? DEFAULT_MAX_RECONNECTION_RETRIES

    if (wsReconnect.reconnectInterval !== undefined && (typeof wsReconnect.reconnectInterval !== 'number' || wsReconnect.reconnectInterval < 100)) {
      throw new Error('wsReconnect.reconnectInterval (ms) must be a number greater than or equal to 100')
    }
    wsReconnect.reconnectInterval = wsReconnect.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL

    if (wsReconnect.reconnectDecay !== undefined && (typeof wsReconnect.reconnectDecay !== 'number' || wsReconnect.reconnectDecay < 1)) {
      throw new Error('wsReconnect.reconnectDecay must be a number greater than or equal to 1')
    }
    wsReconnect.reconnectDecay = wsReconnect.reconnectDecay ?? DEFAULT_RECONNECT_DECAY

    if (wsReconnect.connectionTimeout !== undefined && (typeof wsReconnect.connectionTimeout !== 'number' || wsReconnect.connectionTimeout < 0)) {
      throw new Error('wsReconnect.connectionTimeout must be a non-negative number')
    }
    wsReconnect.connectionTimeout = wsReconnect.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT

    if (wsReconnect.reconnectOnClose !== undefined && typeof wsReconnect.reconnectOnClose !== 'boolean') {
      throw new Error('wsReconnect.reconnectOnClose must be a boolean')
    }
    wsReconnect.reconnectOnClose = wsReconnect.reconnectOnClose ?? DEFAULT_RECONNECT_ON_CLOSE

    if (wsReconnect.logs !== undefined && typeof wsReconnect.logs !== 'boolean') {
      throw new Error('wsReconnect.logs must be a boolean')
    }
    wsReconnect.logs = wsReconnect.logs ?? DEFAULT_LOGS
  }

  if (options.wsHooks) {
    const wsHooks = options.wsHooks

    if (wsHooks.onReconnect !== undefined && typeof wsHooks.onReconnect !== 'function') {
      throw new Error('wsHooks.onReconnect must be a function')
    }

    if (wsHooks.onIncomingMessage !== undefined && typeof wsHooks.onIncomingMessage !== 'function') {
      throw new Error('wsHooks.onIncomingMessage must be a function')
    }

    if (wsHooks.onOutgoingMessage !== undefined && typeof wsHooks.onOutgoingMessage !== 'function') {
      throw new Error('wsHooks.onOutgoingMessage must be a function')
    }

    if (wsHooks.onPong !== undefined && typeof wsHooks.onPong !== 'function') {
      throw new Error('wsHooks.onPong must be a function')
    }
  } else {
    options.wsHooks = {
      onReconnect: undefined,
      onIncomingMessage: undefined,
      onOutgoingMessage: undefined,
      onPong: undefined,
    }
  }

  return options
}

module.exports = {
  validateOptions,
  DEFAULT_PING_INTERVAL,
  DEFAULT_MAX_RECONNECTION_RETRIES,
  DEFAULT_RECONNECT_INTERVAL,
  DEFAULT_RECONNECT_DECAY,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_RECONNECT_ON_CLOSE,
  DEFAULT_LOGS,
}

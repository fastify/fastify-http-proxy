function createLoggerSpy () {
  return {
    level: 'trace',
    _trace: [],
    _debug: [],
    _info: [],
    _warn: [],
    _error: [],
    _fatal: [],

    trace: function (...args) {
      this._trace.push(args)
    },
    debug: function (...args) {
      this._debug.push(args)
    },
    info: function (...args) {
      this._info.push(args)
    },
    warn: function (...args) {
      this._warn.push(args)
    },
    error: function (...args) {
      this._error.push(args)
    },
    fatal: function (...args) {
      this._fatal.push(args)
    },
    child: function () {
      return this
    },

    reset: function () {
      this._trace = []
      this._debug = []
      this._info = []
      this._warn = []
      this._error = []
      this._fatal = []
    }
  }
}

// TODO use pino-test

module.exports = {
  createLoggerSpy
}

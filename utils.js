'use strict'

function convertUrlToWebSocket (urlString) {
  return urlString.replace(/^(http)(s)?:\/\//, 'ws$2://')
}

// Strip characters that are not valid in an HTTP header value, so proxying a
// reply with an invalid upstream header does not throw.
// Allowed: HTAB (0x09), SP (0x20)-~ (0x7E), and obs-text (0x80-0xFF).
function sanitizeHeaderValue (value) {
  return value.replace(/[^\t\x20-\x7E\x80-\xFF]/g, '')
}

// Sanitize every header value in place. Values may be strings or arrays of
// strings (e.g. set-cookie); anything else is left untouched.
function sanitizeHeaders (headers) {
  for (const key in headers) {
    const value = headers[key]
    if (typeof value === 'string') {
      headers[key] = sanitizeHeaderValue(value)
    } else if (Array.isArray(value)) {
      headers[key] = value.map((v) => (typeof v === 'string' ? sanitizeHeaderValue(v) : v))
    }
  }
  return headers
}

module.exports = {
  convertUrlToWebSocket,
  sanitizeHeaderValue,
  sanitizeHeaders
}

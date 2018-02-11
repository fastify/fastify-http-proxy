'use strict'

const From = require('fastify-reply-from')

module.exports = async function (fastify, opts) {
  if (!opts.upstream) {
    throw new Error('upstream must be specified')
  }

  fastify.register(From, {
    base: opts.upstream
  })

  fastify.addContentTypeParser('*', function (req, done) {
    done(null, req)
  })

  fastify.all('/', reply)
  fastify.all('/*', reply)

  function reply (request, reply) {
    const dest = request.req.url.replace(this.basePath, '')
    reply.from(dest)
  }
}

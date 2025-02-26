import fastify, {
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  type FastifyRequest,
  type RawServerBase,
  type RequestGenericInterface,
} from 'fastify'
import { expectType } from 'tsd'
import fastifyHttpProxy from '..'

const app = fastify()

app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
})

app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  prefix: '/auth',
  rewritePrefix: '/u',
  http2: false,
  config: { key: 1 },
  replyOptions: { contentType: 'application/json' },
  httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS'],
  preHandler: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw)
    expectType<RawReplyDefaultExpression>(reply.raw)
  },
  beforeHandler: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw)
    expectType<RawReplyDefaultExpression>(reply.raw)
  },
  preValidation: (request, reply) => {
    expectType<RawRequestDefaultExpression>(request.raw)
    expectType<RawReplyDefaultExpression>(reply.raw)
  },
  base: 'whatever',
  cacheURLs: 10,
  undici: {
    connections: 128,
    pipelining: 1,
    keepAliveTimeout: 60 * 1000,
    connect: {
      rejectUnauthorized: false,
    },
  },
  http: {
    agentOptions: {
      keepAliveMsecs: 10 * 60 * 1000,
    },
    requestOptions: {
      timeout: 20000,
    },
  },
  constraints: { version: '1.0.2' },
  websocket: true,
  wsUpstream: 'ws://origin.asd/connection',
  wsClientOptions: {
    queryString (search, reqUrl, request) {
      expectType<string | undefined>(search)
      expectType<string>(reqUrl)
      expectType<FastifyRequest<RequestGenericInterface, RawServerBase>>(request)
      return ''
    },
  },
  wsHooks: {
    onConnect: (context, source, target) => {
      expectType<{ log: import('pino').Logger }>(context)
      expectType<import('ws').WebSocket>(source)
      expectType<import('ws').WebSocket>(target)
    },
    onDisconnect: (context, source) => {
      expectType<{ log: import('pino').Logger }>(context)
      expectType<import('ws').WebSocket>(source)
    },
    onIncomingMessage: (context, source, target, message) => {
      expectType<{ log: import('pino').Logger }>(context)
      expectType<import('ws').WebSocket>(source)
      expectType<import('ws').WebSocket>(target)
      expectType<{ data: Buffer | ArrayBuffer | Buffer[], binary: boolean }>(message)
    },
    onOutgoingMessage: (context, source, target, message) => {
      expectType<{ log: import('pino').Logger }>(context)
      expectType<import('ws').WebSocket>(source)
      expectType<import('ws').WebSocket>(target)
      expectType<{ data: Buffer | ArrayBuffer | Buffer[], binary: boolean }>(message)
    },
    onPong: (context, source, target) => {
      expectType<{ log: import('pino').Logger }>(context)
      expectType<import('ws').WebSocket>(source)
      expectType<import('ws').WebSocket>(target)
    },
    onReconnect: (context, source, target) => {
      expectType<{ log: import('pino').Logger }>(context)
      expectType<import('ws').WebSocket>(source)
      expectType<import('ws').WebSocket>(target)
    }
  },
  wsReconnect: {
    pingInterval: 3000,
    reconnectInterval: 1000,
    reconnectDecay: 1.5,
    maxReconnectionRetries: 5,
    connectionTimeout: 5000,
    reconnectOnClose: true,
    logs: true
  },
  internalRewriteLocationHeader: true,
})

// @ts-expect-error
app.register(fastifyHttpProxy, {
  thisOptionDoesNotExist: 'triggers a typescript error',
})

// @ts-expect-error
app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  wsUpstream: 'ws://origin.asd',
})

// @ts-expect-error
app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  websocket: false,
  wsUpstream: 'asdf',
})

// @ts-expect-error
app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  websocket: false,
  internalRewriteLocationHeader: 'NON_BOOLEAN_VALUE'
})

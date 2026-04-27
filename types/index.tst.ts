import fastify, {
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  type FastifyRequest,
  type RawServerBase,
  type RequestGenericInterface,
} from 'fastify'
import { expect } from 'tstyche'
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
    expect(request.raw).type.toBe<RawRequestDefaultExpression>()
    expect(reply.raw).type.toBe<RawReplyDefaultExpression>()
    expect(reply.fromParameters).type.toBe<
      (
        url: string,
        params?: unknown,
        prefix?: string
      ) => { url: string, options: unknown }
    >()
  },
  beforeHandler: (request, reply) => {
    expect(request.raw).type.toBe<RawRequestDefaultExpression>()
    expect(reply.raw).type.toBe<RawReplyDefaultExpression>()
    expect(reply.fromParameters).type.toBe<
      (
        url: string,
        params?: unknown,
        prefix?: string
      ) => { url: string, options: unknown }
    >()
  },
  preValidation: (request, reply) => {
    expect(request.raw).type.toBe<RawRequestDefaultExpression>()
    expect(reply.raw).type.toBe<RawReplyDefaultExpression>()
    expect(reply.fromParameters).type.toBe<
      (
        url: string,
        params?: unknown,
        prefix?: string
      ) => { url: string, options: unknown }
    >()

    const result = reply.fromParameters('/')
    expect(result.options).type.toBe<unknown>()
    expect(result.url).type.toBe<string>()
  },
  preRewrite: (url, params, prefix): string => {
    expect(url).type.toBe<string>()
    expect(params).type.toBe<unknown>()
    expect(prefix).type.toBe<string>()
    return ''
  },
  base: 'whatever',
  cacheURLs: 10,
  undici: {
    connections: 128,
    pipelining: 1,
    keepAliveTimeout: 60 * 1000,
    connect: {
      rejectUnauthorized: false
    }
  },
  http: {
    agentOptions: {
      keepAliveMsecs: 10 * 60 * 1000
    },
    requestOptions: {
      timeout: 20000
    }
  },
  constraints: { version: '1.0.2' },
  websocket: true,
  wsUpstream: 'ws://origin.asd/connection',
  wsClientOptions: {
    queryString (search, reqUrl, request) {
      expect(search).type.toBe<string | undefined>()
      expect(reqUrl).type.toBe<string>()
      expect(request).type.toBe<
        FastifyRequest<RequestGenericInterface, RawServerBase>
      >()
      return ''
    }
  },
  wsHooks: {
    onConnect: (context, source, target) => {
      expect(context).type.toBe<{ log: import('pino').Logger }>()
      expect(source).type.toBe<import('ws').WebSocket>()
      expect(target).type.toBe<import('ws').WebSocket>()
    },
    onDisconnect: (context, source) => {
      expect(context).type.toBe<{ log: import('pino').Logger }>()
      expect(source).type.toBe<import('ws').WebSocket>()
    },
    onIncomingMessage: (context, source, target, message) => {
      expect(context).type.toBe<{ log: import('pino').Logger }>()
      expect(source).type.toBe<import('ws').WebSocket>()
      expect(target).type.toBe<import('ws').WebSocket>()
      expect(message).type.toBe<{
        data: import('ws').RawData
        binary: boolean
      }>()
    },
    onOutgoingMessage: (context, source, target, message) => {
      expect(context).type.toBe<{ log: import('pino').Logger }>()
      expect(source).type.toBe<import('ws').WebSocket>()
      expect(target).type.toBe<import('ws').WebSocket>()
      expect(message).type.toBe<{
        data: import('ws').RawData
        binary: boolean
      }>()
    },
    onPong: (context, source, target) => {
      expect(context).type.toBe<{ log: import('pino').Logger }>()
      expect(source).type.toBe<import('ws').WebSocket>()
      expect(target).type.toBe<import('ws').WebSocket>()
    },
    onReconnect: (context, source, target) => {
      expect(context).type.toBe<{ log: import('pino').Logger }>()
      expect(source).type.toBe<import('ws').WebSocket>()
      expect(target).type.toBe<import('ws').WebSocket>()
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
  internalRewriteLocationHeader: true
})

// @ts-expect-error: No overload matches this call
app.register(fastifyHttpProxy, {
  thisOptionDoesNotExist: 'triggers a typescript error',
})

// @ts-expect-error: No overload matches this call
app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  wsUpstream: 'ws://origin.asd',
})

// @ts-expect-error: No overload matches this call
app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  websocket: false,
  wsUpstream: 'asdf',
})

// @ts-expect-error: Type 'string' is not assignable to type 'boolean | undefined'
app.register(fastifyHttpProxy, {
  upstream: 'http://origin.asd',
  websocket: false,
  internalRewriteLocationHeader: 'NON_BOOLEAN_VALUE'
})

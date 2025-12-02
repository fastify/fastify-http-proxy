/// <reference types='node' />

import {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
  preValidationHookHandler,
  RawServerBase,
  RequestGenericInterface,
} from 'fastify'

import {
  FastifyReplyFromOptions,
  FastifyReplyFromHooks,
} from '@fastify/reply-from'

import { ClientOptions, ServerOptions, WebSocket } from 'ws'
import { Logger } from 'pino'

type FastifyReplyWithFromParameters = FastifyReply & {
  fromParameters: (
    url: string,
    params?: unknown,
    prefix?: string
  ) => { url: string; options: unknown };
}

type ProxyPreHandlerHookHandler = (
  this: preHandlerHookHandler,
  request: Parameters<preHandlerHookHandler>[0],
  reply: FastifyReplyWithFromParameters,
  done: Parameters<preHandlerHookHandler>[2]
) => void

type ProxyPreValidationHookHandler = (
  this: preValidationHookHandler,
  request: Parameters<preValidationHookHandler>[0],
  reply: FastifyReplyWithFromParameters,
  done: Parameters<preValidationHookHandler>[2]
) => void

interface WebSocketHooks {
  onConnect?: (context: { log: Logger }, source: WebSocket, target: WebSocket) => void;
  onDisconnect?: (context: { log: Logger }, source: WebSocket) => void;
  onIncomingMessage?: (context: { log: Logger }, source: WebSocket, target: WebSocket, message: { data: Buffer | ArrayBuffer | Buffer[], binary: boolean }) => void;
  onOutgoingMessage?: (context: { log: Logger }, source: WebSocket, target: WebSocket, message: { data: Buffer | ArrayBuffer | Buffer[], binary: boolean }) => void;
  onPong?: (context: { log: Logger }, source: WebSocket, target: WebSocket) => void;
  onReconnect?: (context: { log: Logger }, source: WebSocket, target: WebSocket) => void;
}

interface WebSocketReconnectOptions {
  pingInterval?: number;
  reconnectInterval?: number;
  reconnectDecay?: number;
  maxReconnectionRetries?: number;
  connectionTimeout?: number;
  reconnectOnClose?: boolean;
  logs?: boolean;
}

interface FastifyHttpProxyWebsocketOptionsEnabled {
  websocket: true;
  wsUpstream?: string;
  wsHooks?: WebSocketHooks;
  wsReconnect?: WebSocketReconnectOptions;
}

interface FastifyHttpProxyWebsocketOptionsDisabled {
  websocket?: false | never;
  wsUpstream?: never;
}

type FastifyHttpProxy = FastifyPluginCallback<
  fastifyHttpProxy.FastifyHttpProxyOptions
  & (FastifyHttpProxyWebsocketOptionsEnabled | FastifyHttpProxyWebsocketOptionsDisabled)
>

declare namespace fastifyHttpProxy {
  type ProxyPreRewriteHookHandler = (
    url: string,
    params: unknown,
    prefix: string
  ) => string

  type QueryStringFunction = (
    search: string | undefined,
    reqUrl: string,
    request: FastifyRequest<RequestGenericInterface, RawServerBase>
  ) => string

  export interface FastifyHttpProxyOptions extends FastifyReplyFromOptions {
    upstream: string;
    prefix?: string;
    rewritePrefix?: string;
    proxyPayloads?: boolean;
    preHandler?: ProxyPreHandlerHookHandler;
    beforeHandler?: ProxyPreHandlerHookHandler;
    preValidation?: ProxyPreValidationHookHandler;
    preRewrite?: ProxyPreRewriteHookHandler;
    config?: Object;
    replyOptions?: FastifyReplyFromHooks;
    wsClientOptions?: ClientOptions & { queryString?: { [key: string]: unknown } | QueryStringFunction; };
    wsServerOptions?: ServerOptions;
    httpMethods?: string[];
    constraints?: { [name: string]: any };
    internalRewriteLocationHeader?: boolean;
  }

  export const fastifyHttpProxy: FastifyHttpProxy
  export { fastifyHttpProxy as default }
}

declare function fastifyHttpProxy (...params: Parameters<FastifyHttpProxy>): ReturnType<FastifyHttpProxy>
export = fastifyHttpProxy

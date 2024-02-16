/// <reference types='node' />

import { FastifyPluginCallback, preHandlerHookHandler, preValidationHookHandler } from 'fastify';

import {
  FastifyReplyFromOptions,
  FastifyReplyFromHooks,
} from '@fastify/reply-from';

import { ClientOptions, ServerOptions } from 'ws';

interface FastifyHttpProxyWebsocketOptionsEnabled {
  websocket: true;
  wsUpstream?: string;
}
interface FastifyHttpProxyWebsocketOptionsDisabled {
  websocket?: false | never;
  wsUpstream?: never;
}

type FastifyHttpProxy = FastifyPluginCallback<
  fastifyHttpProxy.FastifyHttpProxyOptions
  & (FastifyHttpProxyWebsocketOptionsEnabled | FastifyHttpProxyWebsocketOptionsDisabled)
>;

declare namespace fastifyHttpProxy {
  export interface FastifyHttpProxyOptions extends FastifyReplyFromOptions {
    upstream: string;
    prefix?: string;
    rewritePrefix?: string;
    proxyPayloads?: boolean;
    preHandler?: preHandlerHookHandler;
    beforeHandler?: preHandlerHookHandler;
    preValidation?: preValidationHookHandler;
    config?: Object;
    replyOptions?: FastifyReplyFromHooks;
    wsClientOptions?: ClientOptions;
    wsServerOptions?: ServerOptions;
    httpMethods?: string[];
    constraints?: { [name: string]: any };
    internalRewriteLocationHeader?: boolean;
  }
  
  export const fastifyHttpProxy: FastifyHttpProxy
  export { fastifyHttpProxy as default }
}

declare function fastifyHttpProxy(...params: Parameters<FastifyHttpProxy>): ReturnType<FastifyHttpProxy>
export = fastifyHttpProxy

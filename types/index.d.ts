/// <reference types='node' />

import { FastifyPluginCallback, preHandlerHookHandler } from 'fastify';

import {
  FastifyReplyFromOptions,
  FastifyReplyFromHooks,
} from '@fastify/reply-from';

import { ClientOptions, ServerOptions } from 'ws';

type FastifyHttpProxy = FastifyPluginCallback<fastifyHttpProxy.FastifyHttpProxyOptions>;

declare namespace fastifyHttpProxy {
  export interface FastifyHttpProxyOptions extends FastifyReplyFromOptions {
    upstream: string;
    prefix?: string;
    rewritePrefix?: string;
    proxyPayloads?: boolean;
    preHandler?: preHandlerHookHandler;
    beforeHandler?: preHandlerHookHandler;
    config?: Object;
    replyOptions?: FastifyReplyFromHooks;
    websocket?: boolean;
    wsClientOptions?: ClientOptions;
    wsServerOptions?: ServerOptions;
    httpMethods?: string[];
    constraints?: { [name: string]: any };
  }
  
  export const fastifyHttpProxy: FastifyHttpProxy
  export { fastifyHttpProxy as default }
}

declare function fastifyHttpProxy(...params: Parameters<FastifyHttpProxy>): ReturnType<FastifyHttpProxy>
export = fastifyHttpProxy

/// <reference types='node' />

import {
  FastifyPluginCallback,
  FastifyRequest,
  preHandlerHookHandler,
  preValidationHookHandler,
  RawServerBase,
  RequestGenericInterface,
} from 'fastify';

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
  type QueryStringFunction = (
    search: string | undefined,
    reqUrl: string,
    request: FastifyRequest<RequestGenericInterface, RawServerBase>
  ) => string;

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
    wsClientOptions?: ClientOptions & { queryString?: { [key: string]: unknown } | QueryStringFunction; };
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

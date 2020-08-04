/// <reference types="node" />

import {
  FastifyPlugin,
  preHandlerHookHandler
} from "fastify";

import {
  FastifyReplyFromOptions
} from "fastify-reply-from"

export interface FastifyHttpProxyOptions extends FastifyReplyFromOptions {
  upstream: string;
  prefix?: string;
  rewritePrefix?: string;
  proxyPayloads?: boolean;
  preHandler?: preHandlerHookHandler;
  beforeHandler?: preHandlerHookHandler;
  config?: Object;
  replyOptions?: Object;
}

declare const fastifyHttpProxy: FastifyPlugin<FastifyHttpProxyOptions>;
export default fastifyHttpProxy;

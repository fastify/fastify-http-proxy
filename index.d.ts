/// <reference types="node" />

import {
  FastifyPlugin,
  preHandlerHookHandler
} from "fastify";

export interface FastifyHttpProxyOptions {
  upstream: string;
  prefix?: string;
  rewritePrefix?: string;
  http2?: boolean;
  proxyPayloads?: boolean;
  preHandler?: preHandlerHookHandler;
  beforeHandler?: preHandlerHookHandler;
  config?: Object;
  replyOptions?: Object;
}

declare const fastifyHttpProxy: FastifyPlugin<FastifyHttpProxyOptions>;
export default fastifyHttpProxy;

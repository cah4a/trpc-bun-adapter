# tRPC Bun Adapter

[![npm version](https://badge.fury.io/js/trpc-bun-adapter.svg)](https://badge.fury.io/js/trpc-bun-adapter)
[![License](https://img.shields.io/github/license/cah4a/trpc-bun-adapter)](https://opensource.org/licenses/MIT)

## Description


`trpc-bun-adapter` is a [tRPC](https://trpc.io/) adapter for [Bun](https://github.com/OptimalBits/bun).

Start both HTTP and WebSockets transports with ease.

## Quick Start

Install packages:
```bash
bun install @trpc/server trpc-bun-adapter
```

Create a server.ts file with the following content:
```ts
import {initTRPC} from '@trpc/server';
import {createBunServeHandler} from 'trpc-bun-adapter';

const t = initTRPC.create();

export const router = t.router({
    ping: t.procedure.query(() => "pong"),
});

Bun.serve(createBunServeHandler({ router }));
```

To start the server, run:
```bash
bun run server.ts
bun run --watch server.ts # to restart on file changes
```

Check that it works:
```bash
curl http://localhost:3000/ping
```

## Example

for a full example, see the [example](./example/) directory.

## API Reference

Ensure you have created a `router.ts` file as outlined in the tRPC documentation: [Define Routers](https://trpc.io/docs/server/routers).

### createBunServeHandler

Creates a Bun serve handler:

```ts
import {createBunServeHandler, CreateBunContextOptions} from 'trpc-bun-adapter';
import {router} from './router';

const createContext = (opts: CreateBunContextOptions) => ({
    user: 1,
});

Bun.serve(
    createBunServeHandler(
        {
            router,
            // optional arguments:
            endpoint: '/trpc', // Default to ""
            createContext,
            onError: console.error,
            responseMeta(opts) {
                return {
                    status: 202,
                    headers: {},
                }
            },
            batching: {
                enabled: true,
            },
        },
        {
            // Bun serve options
            port: 3001,
            fetch(request, server) {
                // will be executed if it's not a TRPC request
                return new Response("Hello world");
            },
        },
    ),
);
```

To add response headers like Cross-origin resource sharing (CORS) use `responseMeta` option:
```ts
Bun.serve(
   createBunServeHandler({
         router: appRouter,
         responseMeta(opts) {
            return {
               status: 200,
               headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                  "Access-Control-Allow-Headers": "Content-Type, Authorization"
               }
            };
         }
      }
   )
);
```

### createBunHttpHandler

Creates a Bun HTTP handler for tRPC HTTP requests:

```ts
import {createBunHttpHandler, CreateBunContextOptions} from 'trpc-bun-adapter';
import {router} from './router';

const createContext = (opts: CreateBunContextOptions) => ({
    user: 1,
});

const bunHandler = createBunHttpHandler({
    router,
    // optional arguments:
    endpoint: '/trpc', // Default to ""
    createContext,
    onError: console.error,
    responseMeta(opts) {
        return {
            status: 202,
            headers: {},
        }
    },
    batching: {
        enabled: true,
    },
    emitWsUpgrades: false, // pass true to upgrade to WebSocket
});

Bun.serve({
    fetch(request, response) {
        return bunHandler(request, response) ?? new Response("Not found", {status: 404});
    }
});
```

### createBunWsHandler

Creates a Bun WebSocket handler for tRPC websocket requests:

```ts
import { createBunWSHandler, CreateBunContextOptions } from './src';
import { router } from './router';

const createContext = (opts: CreateBunContextOptions) => ({
    user: 1,
});

const websocket = createBunWSHandler({
    router,
    // optional arguments:
    createContext,
    onError: console.error,
    batching: {
        enabled: true,
    },
});

Bun.serve({
    fetch(request, server) {
        if (server.upgrade(request, {data: {req: request}})) {
            return;
        }

        return new Response("Please use websocket protocol", {status: 404});
    },
    websocket,
});
```

### CreateBunContextOptions

To ensure your router recognizes the context type, define a `createContext` function utilizing the `CreateBunContextOptions` type:

```ts
import { initTRPC } from '@trpc/server';
import type { CreateBunContextOptions } from "src/createBunHttpHandler";

export const createContext = async (opts: CreateBunContextOptions) => {
    return {
        authorization: req.headers.get('Authorization')
    };
};
```

With `createContext` defined, you can use it in your router to access the context, such as the authorization information:
```ts
const t = initTRPC.context<typeof createContext>().create();

export const router = t.router({
    session: t.procedure.query(({ ctx }) => ctx.authorization),
});
```

Finally, pass your `createContext` function besides `router` to `createBunHttpHandler`. 
This integrates your custom context into the HTTP handler setup:
```ts
createBunHttpHandler({
    router,
    createContext,
})
```

Read more documentation about tRPC contexts here: [Contexts](https://trpc.io/docs/server/context)

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/cah4a/trpc-bun-adapter/blob/main/LICENSE) file for details.

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

import { initTRPC } from "@trpc/server";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import {
    type BunWSClientCtx,
    type BunWSClientData,
    createBunHttpHandler,
    createBunServeHandler,
    createBunWSHandler,
} from "../dist";

// Compile the published declarations, including the documented quick start.
// This function is deliberately never called.
export function checkTypes() {
    const t = initTRPC.create();
    const router = t.router({ ping: t.procedure.query(() => "pong") });
    Bun.serve(createBunServeHandler({ router }));
    Bun.serve(createBunServeHandler({ router }, { unix: "/tmp/trpc.sock" }));
    // @ts-expect-error Bun forbids mixing unix sockets with TCP options.
    createBunServeHandler({ router }, { unix: "/tmp/trpc.sock", port: 3000 });
    const http = createBunHttpHandler({ router });
    Bun.serve({
        fetch(req, server) {
            return http(req, server) ?? new Response("Not found");
        },
    });

    const contextual = initTRPC.context<{ name: string }>().create();
    const withContext = contextual.router({
        hello: contextual.procedure.query(({ ctx }) => ctx.name),
    });
    Bun.serve(
        createBunServeHandler(
            {
                router: withContext,
                createContext({ req, info }) {
                    const request: Request = req;
                    const signal: AbortSignal = info.signal;
                    return { name: request.url + signal.aborted };
                },
                onError({ req, ctx }) {
                    const request: Request = req;
                    const name: string | undefined = ctx?.name;
                    void [request, name];
                },
            },
            {
                port: 0,
                fetch(req, server) {
                    const same: Server<BunWSClientData> = server;
                    void [this, same];
                    return new Response(req.url);
                },
            },
        ),
    );

    const ws: WebSocketHandler<BunWSClientData> = createBunWSHandler({
        router: withContext,
        async createContext({ req, res, info }) {
            const socket: ServerWebSocket<BunWSClientCtx<typeof withContext>> =
                res;
            const signal: AbortSignal = info.signal;
            void [socket, signal];
            return { name: req.url };
        },
    });
    Bun.serve({
        fetch(req, server) {
            if (server.upgrade(req, { data: { req } })) return;
            return new Response("Upgrade required");
        },
        websocket: ws,
    });

    // A router with required context must still require a context factory.
    // @ts-expect-error Missing required context factory.
    createBunWSHandler({ router: withContext });
    // @ts-expect-error Missing required context factory.
    createBunServeHandler({ router: withContext });
    // @ts-expect-error Missing required context factory.
    createBunHttpHandler({ router: withContext });
    // @ts-expect-error Context return type must match the router.
    createBunWSHandler({ router: withContext, createContext: () => ({}) });
}

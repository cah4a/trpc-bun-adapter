import type { AnyRouter } from "@trpc/server";
import type { ServeOptions, Server } from "bun";
import {
    type BunHttpHandlerOptions,
    createBunHttpHandler,
} from "./createBunHttpHandler";
import {
    type BunWSAdapterOptions,
    type BunWSClientData,
    createBunWSHandler,
} from "./createBunWSHandler";

// Preserve Bun's mutually exclusive TCP/unix and fetch/routes options.
type Optional<T, K extends keyof T> = T extends unknown
    ? Pick<Partial<T>, K> & Omit<T, K>
    : never;

export function createBunServeHandler<TRouter extends AnyRouter>(
    opts: BunHttpHandlerOptions<TRouter> & BunWSAdapterOptions<TRouter>,
    serveOptions?: Optional<ServeOptions<BunWSClientData>, "fetch">,
): ServeOptions<BunWSClientData> {
    const trpcHandler = createBunHttpHandler({
        ...opts,
        emitWsUpgrades: true,
    });

    return {
        ...serveOptions,
        async fetch(req: Request, server: Server<BunWSClientData>) {
            const trpcResponse = trpcHandler(req, server);

            if (trpcResponse) {
                return trpcResponse;
            }

            return serveOptions?.fetch?.call(server, req, server);
        },
        websocket: createBunWSHandler(opts),
    };
}

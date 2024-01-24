import type { ServeOptions, Server } from "bun";
import { createBunWSHandler } from "./createBunWSHandler";
import {
    BunHttpHandlerOptions,
    createBunHttpHandler,
} from "./createBunHttpHandler";
import type { AnyRouter } from "@trpc/server";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export function createBunServeHandler<TRouter extends AnyRouter>(
    opts: BunHttpHandlerOptions<TRouter>,
    serveOptions?: Optional<ServeOptions, "fetch">,
) {
    const trpcHandler = createBunHttpHandler({
        ...opts,
        emitWsUpgrades: true,
    });

    return {
        ...serveOptions,
        async fetch(req: Request, server: Server) {
            const trpcReponse = trpcHandler(req, server);

            if (trpcReponse) {
                return trpcReponse;
            }

            return serveOptions?.fetch?.call(server, req, server);
        },
        websocket: createBunWSHandler(opts),
    };
}

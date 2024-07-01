import { Server } from "bun";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyRouter, inferRouterContext } from "@trpc/server";
import type {
    FetchHandlerRequestOptions,
    FetchCreateContextFnOptions,
} from "@trpc/server/adapters/fetch";

export type CreateBunContextOptions = FetchCreateContextFnOptions;

export type BunHttpHandlerOptions<TRouter extends AnyRouter> =
    FetchHandlerRequestOptions<TRouter> & {
        endpoint?: string;
        createContext?: (
            opts: CreateBunContextOptions,
        ) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
    };

export function createBunHttpHandler<TRouter extends AnyRouter>(
    opts: BunHttpHandlerOptions<TRouter> & { emitWsUpgrades?: boolean },
) {
    return (request: Request, server: Server) => {
        const url = new URL(request.url);

        if (opts.endpoint && !url.pathname.startsWith(opts.endpoint)) {
            return;
        }

        if (
            opts.emitWsUpgrades &&
            server.upgrade(request, { data: { req: request } })
        ) {
            return new Response(null, { status: 101 });
        }

        return fetchRequestHandler({
            ...opts,
            req: request,
            endpoint: opts.endpoint ?? "",
        });
    };
}

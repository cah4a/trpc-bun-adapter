import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { createBunServeHandler } from "trpc-bun-adapter";

const t = initTRPC.create();

export const router = t.router({
    ping: t.procedure.query(() => {
        return "pong";
    }),

    subscribe: t.procedure.subscription(() => {
        return observable<number>((emit) => {
            emit.next(Math.random());
            emit.complete();
        });
    }),
});

export type AppRouter = typeof router;

Bun.serve(
    createBunServeHandler(
        {
            endpoint: "/trpc",
            router,
        },
        {
            fetch(req) {
                const url = new URL(req.url);
                if (url.pathname === "/app.js") {
                    return new Response(Bun.file("./dist/app.js"));
                }

                if (url.pathname === "/") {
                    return new Response(Bun.file("./index.html"));
                }

                return new Response("Not found", { status: 404 });
            },
        },
    ),
);

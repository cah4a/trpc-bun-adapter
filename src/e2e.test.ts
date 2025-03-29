import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import type { Server } from "bun";
import { type CreateBunContextOptions, createBunServeHandler } from "./index";

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("e2e", () => {
    let server: Server;

    const t = initTRPC
        .context<{
            name: string;
            params: CreateBunContextOptions["info"]["connectionParams"];
        }>()
        .create();

    const router = t.router({
        hello: t.procedure.query(({ ctx }) => `Hello ${ctx.name}!`),

        exception: t.procedure.query(() => {
            throw new Error("MyError");
        }),

        digits: t.procedure.subscription(() =>
            observable<number>((subscriber) => {
                setTimeout(() => {
                    subscriber.next(0);
                    subscriber.next(1);
                    subscriber.next(2);
                    subscriber.error(new Error("MyError"));
                }, 10);
            }),
        ),

        names: t.procedure.subscription(async function* () {
            await wait(10);
            yield "gollum";
            yield "gandalf";
            yield "frodo";
            throw new Error("MyError");
        }),

        params: t.procedure.query(({ ctx }) => ctx.params),
    });

    beforeAll(async () => {
        server = Bun.serve(
            createBunServeHandler(
                {
                    router,
                    endpoint: "/trpc",
                    createContext({ req, info }) {
                        return {
                            name: req.headers.get("x-name") ?? "World",
                            params: info.connectionParams,
                        };
                    },
                },
                {
                    port: 13123,
                    fetch(request, server): Response | Promise<Response> {
                        return new Response("Falling back to fetch");
                    },
                },
            ),
        );
    });

    afterAll(() => server.stop(true));

    test("http call procedure", async () => {
        const response = await fetch("http://localhost:13123/trpc/hello");
        expect(response.ok).toBe(true);
        const result = await response.json();
        expect(result).toEqual({ result: { data: "Hello World!" } });
    });

    test("http call procedure +ctx", async () => {
        const response = await fetch("http://localhost:13123/trpc/hello", {
            headers: {
                "x-name": "John",
            },
        });
        expect(response.ok).toBe(true);
        const result = await response.json();
        expect(result).toEqual({ result: { data: "Hello John!" } });
    });

    test("http call exception", async () => {
        const response = await fetch("http://localhost:13123/trpc/exception");
        expect(response.ok).toBe(false);
        const result = await response.json();
        expect(result).toEqual({
            error: {
                code: -32603,
                message: "MyError",
                data: {
                    code: "INTERNAL_SERVER_ERROR",
                    httpStatus: 500,
                    path: "exception",
                    stack: expect.any(String),
                },
            },
        });
    });

    test("websocket call procedure", async () => {
        const ws = new WebSocket("ws://localhost:13123/trpc");
        const id = Math.random();

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    id,
                    method: "query",
                    params: {
                        path: "hello",
                    },
                }),
            );
        };

        await new Promise((resolve, reject) => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                try {
                    expect(data).toEqual({
                        id,
                        result: {
                            type: "data",
                            data: "Hello World!",
                        },
                    });
                } finally {
                    resolve(true);
                }
            };
        });

        ws.close();
    });

    test("ws error", async () => {
        const ws = new WebSocket("ws://localhost:13123/trpc");
        const id = Math.random();

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    id,
                    method: "query",
                    params: {
                        path: "unknown",
                    },
                }),
            );
        };

        await new Promise((resolve, reject) => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                try {
                    expect(data).toEqual({
                        id,
                        error: {
                            code: -32004,
                            message: `No "query"-procedure on path "unknown"`,
                            data: {
                                code: "NOT_FOUND",
                                httpStatus: 404,
                                path: "unknown",
                                stack: expect.any(String),
                            },
                        },
                    });
                } finally {
                    resolve(true);
                }
            };
        });

        ws.close();
    });

    test("ws exception", async () => {
        const ws = new WebSocket("ws://localhost:13123/trpc");
        const id = Math.random();

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    id,
                    method: "query",
                    params: {
                        path: "exception",
                    },
                }),
            );
        };

        await new Promise((resolve, reject) => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                try {
                    expect(data).toEqual({
                        id,
                        error: {
                            code: -32603,
                            message: "MyError",
                            data: {
                                code: "INTERNAL_SERVER_ERROR",
                                httpStatus: 500,
                                path: "exception",
                                stack: expect.any(String),
                            },
                        },
                    });
                } finally {
                    resolve(true);
                }
            };
        });

        ws.close();
    });

    test("websocket call subscription", async () => {
        const ws = new WebSocket("ws://localhost:13123/trpc");

        const messages: unknown[] = [];
        const id = Math.random();

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    id,
                    method: "subscription",
                    params: {
                        path: "digits",
                    },
                }),
            );
        };

        await new Promise<void>((resolve) => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                messages.push(data);

                if (data?.result?.type === "stopped") {
                    resolve();
                }
            };
        });

        ws.send(
            JSON.stringify({
                id,
                method: "subscription.stop",
            }),
        );

        ws.close();

        expect(messages).toEqual([
            {
                id,
                result: {
                    type: "started",
                },
            },
            {
                id,
                result: {
                    type: "data",
                    data: 0,
                },
            },
            {
                id,
                result: {
                    type: "data",
                    data: 1,
                },
            },
            {
                id,
                result: {
                    type: "data",
                    data: 2,
                },
            },
            {
                id,
                error: {
                    code: -32603,
                    message: "MyError",
                    data: {
                        code: "INTERNAL_SERVER_ERROR",
                        httpStatus: 500,
                        path: "digits",
                        stack: expect.any(String),
                    },
                },
            },
            {
                id,
                result: {
                    type: "stopped",
                },
            },
        ]);
    });

    test("websocket call subscription (generator function)", async () => {
        const ws = new WebSocket("ws://localhost:13123/trpc");

        const messages: unknown[] = [];
        const id = Math.random();

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    id,
                    method: "subscription",
                    params: {
                        path: "names",
                    },
                }),
            );
        };

        await new Promise<void>((resolve) => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                messages.push(data);

                if (data?.result?.type === "stopped") {
                    resolve();
                }
            };
        });

        ws.send(
            JSON.stringify({
                id,
                method: "subscription.stop",
            }),
        );

        ws.close();

        expect(messages).toEqual([
            {
                id,
                result: {
                    type: "started",
                },
            },
            {
                id,
                result: {
                    type: "data",
                    data: "gollum",
                },
            },
            {
                id,
                result: {
                    type: "data",
                    data: "gandalf",
                },
            },
            {
                id,
                result: {
                    type: "data",
                    data: "frodo",
                },
            },
            {
                id,
                error: {
                    code: -32603,
                    message: "MyError",
                    data: {
                        code: "INTERNAL_SERVER_ERROR",
                        httpStatus: 500,
                        path: "names",
                        stack: expect.any(String),
                    },
                },
            },
            {
                id,
                result: {
                    type: "stopped",
                },
            },
        ]);
    });

    test("fall through to fetch", async () => {
        const response = await fetch("http://localhost:13123/other");
        expect(response.ok).toBe(true);
        const result = await response.text();
        expect(result).toEqual("Falling back to fetch");
    });

    test("websocket connection params", async () => {
        const ws = new WebSocket(
            "ws://localhost:13123/trpc?connectionParams=1",
        );

        ws.onopen = () => {
            ws.send(
                JSON.stringify({
                    id: 1,
                    method: "connectionParams",
                    data: {
                        foo: "bar",
                    },
                }),
            );

            ws.send(
                JSON.stringify({
                    id: 2,
                    method: "query",
                    params: {
                        path: "params",
                    },
                }),
            );
        };

        const messages: unknown[] = [];

        await new Promise<void>((resolve) => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                messages.push(data);
                resolve();
            };
        });

        ws.close();

        expect(messages).toEqual([
            {
                id: 2,
                result: {
                    type: "data",
                    data: {
                        foo: "bar",
                    },
                },
            },
        ]);
    });
});

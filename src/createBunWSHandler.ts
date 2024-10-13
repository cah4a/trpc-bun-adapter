import { ServerWebSocket, WebSocketHandler } from "bun";
import {
    parseTRPCMessage,
    TRPCClientOutgoingMessage,
    TRPCResponseMessage,
    TRPCResultMessage,
} from "@trpc/server/rpc";
import {
    AnyRouter,
    callProcedure,
    getErrorShape,
    transformTRPCResponse,
    getTRPCErrorFromUnknown,
    inferRouterContext,
    TRPCError,
    isTrackedEnvelope,
} from "@trpc/server";
import {
    isObservable,
    observableToAsyncIterable,
} from "@trpc/server/observable";
import type { BaseHandlerOptions } from "@trpc/server/src/@trpc/server/http";
import type { CreateContextCallback } from "@trpc/server/src/@trpc/server";
import type { MaybePromise } from "@trpc/server/src/unstable-core-do-not-import";
import type { NodeHTTPCreateContextFnOptions } from "@trpc/server/src/adapters/node-http";

export type CreateBunWSSContextFnOptions = Omit<
    NodeHTTPCreateContextFnOptions<Request, ServerWebSocket<BunWSClientCtx>>,
    "info"
>;

export type BunWSAdapterOptions<TRouter extends AnyRouter> = BaseHandlerOptions<
    TRouter,
    Request
> &
    CreateContextCallback<
        inferRouterContext<TRouter>,
        (
            opts: CreateBunWSSContextFnOptions,
        ) => MaybePromise<inferRouterContext<TRouter>>
    >;

export type BunWSClientCtx = {
    req: Request;
    handleRequest: (msg: TRPCClientOutgoingMessage) => Promise<void>;
    unsubscribe(): void;
};

export function createBunWSHandler<TRouter extends AnyRouter>(
    opts: BunWSAdapterOptions<TRouter>,
): WebSocketHandler<BunWSClientCtx> {
    const {router, createContext} = opts;

    const respond = (
        client: ServerWebSocket<unknown>,
        untransformedJSON: TRPCResponseMessage,
    ) => {
        client.send(
            JSON.stringify(
                transformTRPCResponse(
                    opts.router._def._config,
                    untransformedJSON,
                ),
            ),
        );
    };

    return {
        async open(client) {
            const {req} = client.data;
            const clientAbortControllers = new Map<
                string | number,
                AbortController
            >();

            const ctxPromise = createContext?.({
                req,
                res: client,
            });
            let ctx: inferRouterContext<TRouter> | undefined = undefined;
            await (async () => {
                try {
                    ctx = await ctxPromise;
                } catch (cause) {
                    const error = getTRPCErrorFromUnknown(cause);
                    opts.onError?.({
                        error,
                        path: undefined,
                        type: "unknown",
                        ctx,
                        req,
                        input: undefined,
                    });
                    respond(client, {
                        id: null,
                        error: getErrorShape({
                            config: router._def._config,
                            error,
                            type: "unknown",
                            path: undefined,
                            input: undefined,
                            ctx,
                        }),
                    });

                    // close in next tick
                    setImmediate(() => client.close());
                }
            })();

            client.data.handleRequest = async (
                msg: TRPCClientOutgoingMessage,
            ) => {
                const {id, jsonrpc} = msg;
                if (id === null) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "`id` is required",
                    });
                }
                if (msg.method === "subscription.stop") {
                    clientAbortControllers.get(id)?.abort();
                    return;
                }
                const {path, lastEventId} = msg.params;
                let {input} = msg.params;
                const type = msg.method;
                try {
                    if (lastEventId !== undefined) {
                        if (isObject(input)) {
                            input = {
                                ...input,
                                lastEventId: lastEventId,
                            };
                        } else {
                            input ??= {
                                lastEventId: lastEventId,
                            };
                        }
                    }
                    await ctxPromise; // asserts context has been set

                    const abortController = new AbortController();
                    const result = await callProcedure({
                        procedures: router._def.procedures,
                        path,
                        getRawInput: () => Promise.resolve(input),
                        ctx,
                        type,
                        signal: abortController.signal,
                    });

                    const isIterableResult =
                        isAsyncIterable(result) || isObservable(result);

                    if (type !== "subscription") {
                        if (isIterableResult) {
                            throw new TRPCError({
                                code: "UNSUPPORTED_MEDIA_TYPE",
                                message: `Cannot return an async iterable or observable from a ${type} procedure with WebSockets`,
                            });
                        }
                        // send the value as data if the method is not a subscription
                        respond(client, {
                            id,
                            jsonrpc,
                            result: {
                                type: "data",
                                data: result,
                            },
                        });
                        return;
                    }

                    if (!isIterableResult) {
                        throw new TRPCError({
                            message: `Subscription ${path} did not return an observable or a AsyncGenerator`,
                            code: "INTERNAL_SERVER_ERROR",
                        });
                    }

                    if (client.readyState !== WebSocket.OPEN) {
                        // if the client got disconnected whilst initializing the subscription
                        // no need to send stopped message if the client is disconnected

                        return;
                    }

                    if (clientAbortControllers.has(id)) {
                        // duplicate request ids for client

                        throw new TRPCError({
                            message: `Duplicate id ${id}`,
                            code: "BAD_REQUEST",
                        });
                    }

                    const iterable = isObservable(result)
                        ? observableToAsyncIterable(result)
                        : result;

                    const iterator: AsyncIterator<unknown> =
                        iterable[Symbol.asyncIterator]();

                    const abortPromise = new Promise<"abort">((resolve) => {
                        abortController.signal.onabort = () => resolve("abort");
                    });

                    run(async () => {
                        while (true) {
                            const next = await Promise.race([
                                iterator.next().catch(getTRPCErrorFromUnknown),
                                abortPromise,
                            ]);

                            if (next === "abort") {
                                await iterator.return?.();
                                break;
                            }
                            if (next instanceof Error) {
                                const error = getTRPCErrorFromUnknown(next);
                                opts.onError?.({
                                    error,
                                    path,
                                    type,
                                    ctx,
                                    req,
                                    input,
                                });
                                respond(client, {
                                    id,
                                    jsonrpc,
                                    error: getErrorShape({
                                        config: router._def._config,
                                        error,
                                        type,
                                        path,
                                        input,
                                        ctx,
                                    }),
                                });
                                break;
                            }
                            if (next.done) {
                                break;
                            }

                            const result: TRPCResultMessage<unknown>["result"] =
                                {
                                    type: "data",
                                    data: next.value,
                                };

                            if (isTrackedEnvelope(next.value)) {
                                const [id, data] = next.value;
                                result.id = id;
                                result.data = {
                                    id,
                                    data,
                                };
                            }

                            respond(client, {
                                id,
                                jsonrpc,
                                result,
                            });
                        }

                        await iterator.return?.();
                        respond(client, {
                            id,
                            jsonrpc,
                            result: {
                                type: "stopped",
                            },
                        });
                        clientAbortControllers.delete(id);
                    }).catch((cause) => {
                        const error = getTRPCErrorFromUnknown(cause);
                        opts.onError?.({error, path, type, ctx, req, input});
                        respond(client, {
                            id,
                            jsonrpc,
                            error: getErrorShape({
                                config: router._def._config,
                                error,
                                type,
                                path,
                                input,
                                ctx,
                            }),
                        });
                        abortController.abort();
                    });
                    clientAbortControllers.set(id, abortController);

                    respond(client, {
                        id,
                        jsonrpc,
                        result: {
                            type: "started",
                        },
                    });
                } catch (cause) {
                    // procedure threw an error
                    const error = getTRPCErrorFromUnknown(cause);
                    opts.onError?.({error, path, type, ctx, req, input});
                    respond(client, {
                        id,
                        jsonrpc,
                        error: getErrorShape({
                            config: router._def._config,
                            error,
                            type,
                            path,
                            input,
                            ctx,
                        }),
                    });
                }
            };

            client.data.unsubscribe = () => {
                for (const ctrl of clientAbortControllers.values()) {
                    ctrl.abort();
                }
                clientAbortControllers.clear();
            };
        },

        async close(client) {
            client.data.unsubscribe?.();
        },

        async message(client, message) {
            try {
                const msgJSON: unknown = JSON.parse(message.toString());
                const msgs: unknown[] = Array.isArray(msgJSON)
                    ? msgJSON
                    : [msgJSON];

                const promises = msgs
                    .map((raw) =>
                        parseTRPCMessage(raw, router._def._config.transformer),
                    )
                    .map(client.data.handleRequest);

                await Promise.all(promises);
            } catch (cause) {
                const error = new TRPCError({
                    code: "PARSE_ERROR",
                    cause,
                });

                respond(client, {
                    id: null,
                    error: getErrorShape({
                        config: router._def._config,
                        error,
                        type: "unknown",
                        path: undefined,
                        input: undefined,
                        ctx: undefined,
                    }),
                });
            }
        },
    };
}

// util functions of @trpc/server that are not exported, unfortunately

function isAsyncIterable<TValue>(
    value: unknown,
): value is AsyncIterable<TValue> {
    return isObject(value) && Symbol.asyncIterator in value;
}

function run<TValue>(fn: () => TValue): TValue {
    return fn();
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && !Array.isArray(value) && typeof value === "object";
}

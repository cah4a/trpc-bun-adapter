import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    createTRPCReact,
    createWSClient,
    httpLink,
    splitLink,
    wsLink,
} from "@trpc/react-query";
import type { AppRouter } from "../server";

const trpc = createTRPCReact<AppRouter>();

function App() {
    const [queryClient] = useState(() => new QueryClient());
    const [trpcClient] = useState(() =>
        trpc.createClient({
            links: [
                splitLink({
                    condition: (op) => op.type === "subscription",
                    true: wsLink({
                        client: createWSClient({
                            url: "ws://localhost:3000/trpc",
                        }),
                    }),
                    false: httpLink({ url: "http://localhost:3000/trpc" }),
                }),
            ],
        }),
    );
    return (
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>
                <div style={{ padding: 20 }}>
                    <QueryExample />
                    <SubscribeExample />
                </div>
            </QueryClientProvider>
        </trpc.Provider>
    );
}

function QueryExample() {
    const { data } = trpc.ping.useQuery();
    return <div>Ping query: {data}</div>;
}

function SubscribeExample() {
    const [number, setNumber] = useState<number>();

    trpc.subscribe.useSubscription(undefined, {
        onData(data) {
            setNumber(data);
        },
    });

    return <div>Subscribe: {number}</div>;
}

const el = document.getElementById("root");

if (!el) {
    throw new Error("No root element");
}

const root = ReactDOM.createRoot(el);

root.render(<App />);

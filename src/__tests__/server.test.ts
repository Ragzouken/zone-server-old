import { once } from 'events';
import * as Memory from 'lowdb/adapters/Memory';
import { Server } from 'http';
import * as WebSocket from 'ws';
import { AddressInfo } from 'net';

import { host, HostOptions } from '../server';
import WebSocketMessaging, { Message } from '../messaging';

function socketAddress(server: Server) {
    const address = server.address() as AddressInfo;
    return `ws://localhost:${address.port}/zone`;
}

async function using<T>(resource: T, cleanup: (resource: T) => void, action: (resource: T) => Promise<void>) {
    await action(resource).finally(() => cleanup(resource));
}

async function server(options: Partial<HostOptions>, callback: (server: TestServer) => Promise<void>) {
    const server = new TestServer(options);
    await once(server.server, 'listening');
    await using(server, (server) => server.dispose(), callback);
}

class TestServer {
    public readonly server: Server;
    private readonly sockets: WebSocket[] = [];

    constructor(options?: Partial<HostOptions>) {
        this.server = host(new Memory(''), options);
    }

    public async socket() {
        const socket = new WebSocket(socketAddress(this.server));
        this.sockets.push(socket);
        await once(socket, 'open');
        return socket;
    }

    public dispose() {
        this.sockets.forEach((socket) => socket.close());
        this.server.close();
    }
}

async function waitResponse(
    messaging: WebSocketMessaging,
    sendType: string,
    sendMessage: any,
    responseType: string,
): Promise<Message> {
    return new Promise((resolve, reject) => {
        messaging.setHandler(responseType, (message) => {
            messaging.setHandler(responseType, () => {});
            resolve(message);
        });
        messaging.send(sendType, sendMessage);
    });
}

test('can connect to a server', async () => {
    await server({}, async (server) => {
        const websocket = await server.socket();
    });
});

test('can join unpassworded server', async () => {
    await server({}, async (server) => {
        const messaging = new WebSocketMessaging(await server.socket());
        await waitResponse(messaging, 'join', { name: 'test' }, 'assign');
    });
});

test("can't join passworded server without password", async () => {
    const password = 'riverdale';
    await server({ joinPassword: password }, async (server) => {
        const messaging = new WebSocketMessaging(await server.socket());
        await waitResponse(messaging, 'join', { name: 'test' }, 'reject');
    });
});

test('can join passworded server with password', async () => {
    const password = 'riverdale';
    await server({ joinPassword: password }, async (server) => {
        const messaging = new WebSocketMessaging(await server.socket());
        await waitResponse(messaging, 'join', { name: 'test', password }, 'assign');
    });
});

test('can resume session with token', async () => {
    await server({}, async (server) => {
        const messaging1 = new WebSocketMessaging(await server.socket());
        const messaging2 = new WebSocketMessaging(await server.socket());

        const assign1 = await waitResponse(messaging1, 'join', { name: 'test' }, 'assign');
        messaging1.disconnect(3000);
        const assign2 = await waitResponse(messaging2, 'join', { name: 'test', token: assign1.token }, 'assign');

        expect(assign2.userId).toEqual(assign1.userId);
        expect(assign2.token).toEqual(assign1.token);
    });
});

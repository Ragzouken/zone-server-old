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

async function server(options: Partial<HostOptions>, callback: (server: TestServer) => Promise<void>) {
    const server = new TestServer(options);
    try {
        await once(server.server, 'listening');
        await callback(server);
    } finally {
        server.dispose();
    }
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

    public async messaging() {
        return new WebSocketMessaging(await this.socket());
    }

    public dispose() {
        this.sockets.forEach((socket) => socket.close());
        this.server.close();
    }
}


async function response(messaging: WebSocketMessaging, type: string): Promise<any> {
    return new Promise((resolve) => {
        messaging.setHandler(type, (message) => {
            messaging.setHandler(type, () => {});
            resolve(message);
        });
    });
}

function join(messaging: WebSocketMessaging, message: any = {}) {
    return new Promise<Message>((resolve, reject) => {
        messaging.setHandler('assign', resolve);
        messaging.setHandler('reject', () => reject(new Error()));
        messaging.send('join', Object.assign({ name: 'anonymous' }, message));
    });
}

async function exchange(
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
        const messaging = await server.messaging();
        await join(messaging);
    });
});

test("can't join passworded server without password", async () => {
    const password = 'riverdale';
    await server({ joinPassword: password }, async (server) => {
        const messaging = await server.messaging();
        await expect(join(messaging)).rejects.toThrow(Error);
    });
});

test('can join passworded server with password', async () => {
    const password = 'riverdale';
    await server({ joinPassword: password }, async (server) => {
        const messaging = await server.messaging();
        await join(messaging, { password });
    });
});

test('can resume session with token', async () => {
    await server({}, async (server) => {
        const messaging1 = await server.messaging();
        const messaging2 = await server.messaging();

        const assign1 = await join(messaging1);
        messaging1.disconnect(3000);
        const assign2 = await join(messaging2, { token: assign1.token });

        expect(assign2.userId).toEqual(assign1.userId);
        expect(assign2.token).toEqual(assign1.token);
    });
});

test('heartbeat response', async () => {
    await server({}, async (server) => {
        const messaging = await server.messaging();
        await join(messaging);
        await exchange(messaging, 'heartbeat', {}, 'heartbeat');
    });
});

test('server sends user list', async () => {
    await server({}, async (server) => {
        const name = 'user1';
        const messaging1 = await server.messaging();
        const messaging2 = await server.messaging();
        const { userId } = await join(messaging1, { name });

        const waitUsers = response(messaging2, 'users');
        await join(messaging2);
        const { users } = await waitUsers;
        
        expect(users[0]).toMatchObject({ userId, name });
    });
});

test('server sends currently playing', async () => {
    await server({}, async (server) => {
        const messaging1 = await server.messaging();
        const messaging2 = await server.messaging();
        
        await join(messaging1);
        const video1 = await exchange(messaging1, 'youtube', { videoId: '2GjyNgQ4Dos' }, 'play');

        const waiter = response(messaging2, 'play');
        await join(messaging2);
        const video2 = await waiter;

        expect(video2.time).toBeGreaterThan(0);
        expect(video2.item).toEqual(video1.item);
    });
});

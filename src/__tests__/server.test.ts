import { once } from 'events';
import * as Memory from 'lowdb/adapters/Memory';
import { Server } from 'http';
import * as WebSocket from 'ws';
import { AddressInfo } from 'net';

import { host, HostOptions } from '../server';
import WebSocketMessaging, { Message } from '../messaging';
import { QueueItem } from '../playback';
import { copy, sleep } from '../utility';

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

async function response(messaging: WebSocketMessaging, type: string, timeout?: number): Promise<any> {
    return new Promise((resolve, reject) => {
        if (timeout) setTimeout(() => reject('timeout'), timeout);
        messaging.setHandler(type, (message) => {
            messaging.setHandler(type, () => {});
            resolve(message);
        });
    });
}

function join(messaging: WebSocketMessaging, message: any = {}) {
    return new Promise<Message>((resolve, reject) => {
        messaging.setHandler('assign', resolve);
        messaging.setHandler('reject', reject);
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

describe('join open server', () => {
    test('accepts no password', async () => {
        await server({}, async (server) => {
            const messaging = await server.messaging();
            await join(messaging);
        });
    });

    test('accepts any password', async () => {
        await server({}, async (server) => {
            const messaging = await server.messaging();
            await join(messaging, { password: 'old password' });
        });
    });
});

describe('join closed server', () => {
    test('rejects absent password', async () => {
        const password = 'riverdale';
        await server({ joinPassword: password }, async (server) => {
            const messaging = await server.messaging();
            const joining = join(messaging);
            await expect(joining).rejects.toMatchObject({ type: 'reject' });
        });
    });

    test('rejects incorrect password', async () => {
        const password = 'riverdale';
        await server({ joinPassword: password }, async (server) => {
            const messaging = await server.messaging();
            const joining = join(messaging, { password: 'wrong' });
            await expect(joining).rejects.toMatchObject({ type: 'reject' });
        });
    });

    test('accepts correct password', async () => {
        const password = 'riverdale';
        await server({ joinPassword: password }, async (server) => {
            const messaging = await server.messaging();
            await join(messaging, { password });
        });
    });
});

describe('join server', () => {
    it('sends user list', async () => {
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

    test('server sends name on join', async () => {
        await server({}, async (server) => {
            const name = 'baby yoda';
            const messaging1 = await server.messaging();
            const messaging2 = await server.messaging();

            await join(messaging1);
            const waiter = response(messaging1, 'name');
            const { userId } = await join(messaging2, { name });
            const message = await waiter;

            expect(message.userId).toEqual(userId);
            expect(message.name).toEqual(name);
        });
    });
});

describe('playback', () => {
    it('sends currently playing on join', async () => {
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

    it.todo('sends empty play when all playback ends');

    it("doesn't queue duplicate media", async () => {
        await server({}, async (server) => {
            const messaging = await server.messaging();

            const message = { videoId: '2GjyNgQ4Dos' };

            await join(messaging);
            // queue it three times because currently playing doesn't count
            await exchange(messaging, 'youtube', message, 'queue');
            await exchange(messaging, 'youtube', message, 'queue');
            const queue = response(messaging, 'queue', 200);
            messaging.send('youtube', message);

            await expect(queue).rejects.toEqual('timeout');
        });
    });

    it("doesn't queue beyond limit", async () => {
        await server({ perUserQueueLimit: 0 }, async (server) => {
            const messaging = await server.messaging();

            await join(messaging);
            const queue = response(messaging, 'queue', 200);
            messaging.send('youtube', { videoId: '2GjyNgQ4Dos' });

            await expect(queue).rejects.toEqual('timeout');
        });
    });

    it('skips with sufficient votes', async () => {
        await server({ voteSkipThreshold: 1 }, async (server) => {
            const messaging1 = await server.messaging();
            const messaging2 = await server.messaging();

            await join(messaging1);
            await join(messaging2);

            const waiter1 = response(messaging1, 'play');
            const waiter2 = response(messaging2, 'play');

            messaging1.send('youtube', { videoId: '2GjyNgQ4Dos' });

            const { item }: { item: QueueItem } = await waiter1;
            await waiter2;

            const waiter = response(messaging1, 'play');
            messaging1.send('skip', { source: item.media.source });
            messaging2.send('skip', { source: item.media.source });

            await waiter;
        });
    });

    it('skips with sufficient errors', async () => {
        await server({ voteSkipThreshold: 1 }, async (server) => {
            const messaging1 = await server.messaging();
            const messaging2 = await server.messaging();

            await join(messaging1);
            await join(messaging2);

            const waiter1 = response(messaging1, 'play');
            const waiter2 = response(messaging2, 'play');

            messaging1.send('youtube', { videoId: '2GjyNgQ4Dos' });

            const { item }: { item: QueueItem } = await waiter1;
            await waiter2;

            const waiter = response(messaging1, 'play');
            messaging1.send('error', { source: item.media.source });
            messaging2.send('error', { source: item.media.source });

            await waiter;
        });
    });

    it('skips with password', async () => {
        const password = 'riverdale';
        await server({ voteSkipThreshold: 2, skipPassword: password }, async (server) => {
            const messaging = await server.messaging();

            await join(messaging);
            const { item } = await exchange(messaging, 'youtube', { videoId: '2GjyNgQ4Dos' }, 'play');

            const waiter = response(messaging, 'play');
            messaging.send('skip', { source: item.media.source, password });

            await waiter;
        });
    });

    it("doesn't skip incorrect video", async () => {
        await server({}, async (server) => {
            const messaging = await server.messaging();

            await join(messaging);
            const { item } = await exchange(messaging, 'youtube', { videoId: '2GjyNgQ4Dos' }, 'play');

            const source = copy(item.media.source);
            source.videoId = 'fake';

            const skip = response(messaging, 'play', 200);
            messaging.send('skip', { source: source });

            await expect(skip).rejects.toEqual('timeout');
        });
    });
});

test('server sends leave on clean quit', async () => {
    await server({}, async (server) => {
        const messaging1 = await server.messaging();
        const messaging2 = await server.messaging();

        const { userId: joinedId } = await join(messaging1);
        await join(messaging2);

        const waiter = response(messaging2, 'leave');
        messaging1.disconnect();
        const { userId: leftId } = await waiter;

        expect(joinedId).toEqual(leftId);
    });
});

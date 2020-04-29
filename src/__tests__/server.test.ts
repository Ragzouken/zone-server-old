import { host, HostOptions } from '../server';
import * as Memory from 'lowdb/adapters/Memory';
import { Server } from 'http';
import * as WebSocket from 'ws';
import WebSocketMessaging, { Message } from '../messaging';
import { AddressInfo } from 'net';

function socketAddress(server: Server) {
    const address = server.address() as AddressInfo;
    return `ws://localhost:${address.port}/zone`;
}

async function withServer(callback: (server: Server) => Promise<void>, options?: Partial<HostOptions>) {
    const server = host(new Memory(''), options);
    console.log('OPENED');
    await callback(server).finally(() => {
        return new Promise((resolve) => {
            console.log('CLOSING...');
            server.close(() => {
                console.log('CLOSED');
                resolve();
            });
        });
    });
}

async function waitOpen(socket: WebSocket, timeout = 200) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(`timed out waiting for socket open`), timeout);
        socket.on('open', resolve);
    });
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
    await withServer(async (server) => {
        const websocket = new WebSocket(socketAddress(server));
        await waitOpen(websocket);
        websocket.close();
    });
});

test('can join unpassworded server', async () => {
    await withServer(async (server) => {
        const websocket = new WebSocket(socketAddress(server));
        const messaging = new WebSocketMessaging(websocket);

        await waitOpen(websocket);
        await waitResponse(messaging, 'join', { name: 'test' }, 'assign');

        websocket.close();
    });
});

test("can't join passworded server without password", async () => {
    const password = 'riverdale';
    await withServer(
        async (server) => {
            const websocket = new WebSocket(socketAddress(server));
            const messaging = new WebSocketMessaging(websocket);

            await waitOpen(websocket);
            await waitResponse(messaging, 'join', { name: 'test' }, 'reject');

            websocket.close();
        },
        { joinPassword: password },
    );
});

test('can join passworded server with password', async () => {
    const password = 'riverdale';
    await withServer(
        async (server) => {
            const websocket = new WebSocket(socketAddress(server));
            const messaging = new WebSocketMessaging(websocket);

            await waitOpen(websocket);
            await waitResponse(messaging, 'join', { name: 'test', password }, 'assign');

            websocket.close();
        },
        { joinPassword: password },
    );
});

test('can resume session with token', async () => {
    await withServer(async (server) => {
        const websocket1 = new WebSocket(socketAddress(server));
        const messaging1 = new WebSocketMessaging(websocket1);

        await waitOpen(websocket1);
        const assign1 = await waitResponse(messaging1, 'join', { name: 'test' }, 'assign');
        websocket1.close(3000);

        const websocket2 = new WebSocket(socketAddress(server));
        const messaging2 = new WebSocketMessaging(websocket2);

        await waitOpen(websocket2);
        const assign2 = await waitResponse(messaging2, 'join', { name: 'test', token: assign1.token }, 'assign');

        expect(assign2.userId).toEqual(assign1.userId);
        expect(assign2.token).toEqual(assign1.token);

        websocket1.close();
        websocket2.close();
    });
});

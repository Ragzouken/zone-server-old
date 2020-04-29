import { host, HostOptions } from '../server';
import * as Memory from 'lowdb/adapters/Memory';
import { Server } from 'http';
import * as WebSocket from 'ws';
import WebSocketMessaging from '../messaging';
import { AddressInfo } from 'net';

function socketAddress(server: Server) {
    const address = server.address() as AddressInfo;
    return `ws://localhost:${address.port}/zone`;
}

async function withServer(callback: (server: Server) => Promise<void>, options?: Partial<HostOptions>) {
    const server = host(new Memory(''), options);
    await callback(server).finally(() => server.close());
}

test('server is not running', () =>
    new Promise((resolve, reject) => {
        const websocket = new WebSocket('ws://localhost:8080/zone', { handshakeTimeout: 500 });
        websocket.addEventListener('open', () => reject());
        websocket.addEventListener('error', () => resolve());
    }));

test('can host and connected to a server', async () => {
    await withServer(async (server) => {
        console.log(server.address());
        return new Promise((resolve, reject) => {
            const websocket = new WebSocket(socketAddress(server), { handshakeTimeout: 500 });

            websocket.addEventListener('open', () => resolve());
            websocket.addEventListener('closed', () => reject());
        });
    });
});

test('can join unpassworded server', async () => {
    await withServer(async (server) => {
        return new Promise((resolve, reject) => {
            setTimeout(reject, 1000);
            const websocket = new WebSocket(socketAddress(server));
            const messaging = new WebSocketMessaging(websocket);

            messaging.setHandler('assign', () => resolve());
            websocket.addEventListener('open', () => messaging.send('join', { name: 'test' }));
        });
    });
});

test("can't join passworded server without password", async () => {
    const password = 'riverdale';
    await withServer(
        async (server) => {
            return new Promise((resolve, reject) => {
                setTimeout(reject, 1000);
                const websocket = new WebSocket(socketAddress(server));
                const messaging = new WebSocketMessaging(websocket);

                messaging.setHandler('reject', () => resolve());
                messaging.setHandler('assign', () => reject());
                websocket.addEventListener('open', () => messaging.send('join', { name: 'test' }));
            });
        },
        { joinPassword: password },
    );
});

test('can join passworded server with password', async () => {
    const password = 'riverdale';
    await withServer(
        async (server) => {
            return new Promise((resolve, reject) => {
                setTimeout(reject, 1000);
                const websocket = new WebSocket(socketAddress(server));
                const messaging = new WebSocketMessaging(websocket);

                messaging.setHandler('reject', () => reject());
                messaging.setHandler('assign', () => resolve());
                websocket.addEventListener('open', () => messaging.send('join', { name: 'test', password }));
            });
        },
        { joinPassword: password },
    );
});

test('can resume session with token', async () => {
    await withServer(async (server) => {
        return new Promise((resolve, reject) => {
            setTimeout(() => reject('timed out'), 1000);
            const websocket1 = new WebSocket(socketAddress(server));
            const messaging1 = new WebSocketMessaging(websocket1);

            websocket1.addEventListener('open', () => messaging1.send('join', { name: 'test' }));
            messaging1.setHandler('assign', (assign1) => {
                websocket1.close(3000);
                const websocket2 = new WebSocket(socketAddress(server));
                const messaging2 = new WebSocketMessaging(websocket2);

                websocket2.addEventListener('open', () => {
                    messaging2.send('join', { name: 'test', token: assign1.token });
                });
                messaging2.setHandler('assign', (assign2) => {
                    expect(assign2.userId).toEqual(assign1.userId);
                    expect(assign2.token).toEqual(assign1.token);
                    resolve();
                });
                messaging2.setHandler('reject', () => reject('resume rejected'));
            });

            messaging1.setHandler('reject', () => reject('initial join rejected'));
        });
    });
});

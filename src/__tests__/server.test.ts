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

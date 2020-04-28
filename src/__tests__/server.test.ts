import { host } from '../server';
import * as Memory from 'lowdb/adapters/Memory';
import { Server } from 'http';
import * as WebSocket from 'ws';
import WebSocketMessaging from '../messaging';

async function withServer(callback: (server: Server) => Promise<void>) {
    const server = host(new Memory(''));
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
        return new Promise((resolve, reject) => {
            const websocket = new WebSocket('ws://localhost:8080/zone', { handshakeTimeout: 500 });

            websocket.addEventListener('open', () => resolve());
            websocket.addEventListener('closed', () => reject());
        });
    });
});

test('can join unpassworded server', async () => {
    await withServer(async (server) => {
        return new Promise((resolve, reject) => {
            setTimeout(reject, 1000);
            const websocket = new WebSocket('ws://localhost:8080/zone');
            const messaging = new WebSocketMessaging(websocket);

            messaging.setHandler('assign', () => resolve());
            websocket.addEventListener('open', () => messaging.send('join', { name: 'test' }));
        });
    });
});

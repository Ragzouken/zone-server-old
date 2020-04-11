import * as WebSocket from 'ws';

export default class WebSocketMessaging {
    private handlers = new Map<string, (message: any) => void>();

    constructor(private websocket: WebSocket) {
        this.websocket.on('message', (message) => this.onMessage(message));
        this.websocket.on('close', () => this.disconnect());
    }

    disconnect() {
        this.websocket.removeAllListeners();
        this.websocket.close(1000);
    }

    send(type: string, message: any) {
        message.type = type;
        const json = JSON.stringify(message);
        try {
            this.websocket.send(json);
        } catch (e) {
            console.log("couldn't send:", e);
        }
    }

    setHandler(type: string, handler: (message: any) => void) {
        this.handlers.set(type, handler);
    }

    onMessage(data: WebSocket.Data) {
        if (typeof data !== 'string') {
            console.log('WEIRD DATA', data);
            return;
        }

        const message = JSON.parse(data);
        const handler = this.handlers.get(message.type);

        if (handler) {
            try {
                handler(message);
            } catch (e) {
                console.log('EXCEPTION HANDLING MESSAGE', message, e);
            }
        } else {
            console.log(`NO HANDLER FOR MESSAGE TYPE ${message.type}`);
        }
    }
}

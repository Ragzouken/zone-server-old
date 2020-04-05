class WebSocketMessaging {
  constructor(websocket) {
    this.websocket = websocket;
    this.handlers = new Map();

    this.websocket.on("message", message => this.onMessage(message));
    this.websocket.on("close", () => this.disconnect());
  }

  disconnect() {
    if (!this.websocket) return;
    this.websocket.onclose = undefined;
    this.websocket.close(1000);
    this.websocket = undefined;
  }

  send(type, message) {
    if (!this.websocket) return;
    message.type = type;
    const json = JSON.stringify(message);
    this.websocket.send(json);
  }

  setHandler(type, handler) {
    this.handlers.set(type, handler);
  }

  onMessage(json) {
    const message = JSON.parse(json);
    const handler = this.handlers.get(message.type);

    console.log(`<-- ${json}`);

    if (handler) handler(message);
    else console.log(`NO HANDLER FOR MESSAGE TYPE ${message.type}`);
  }
}

module.exports = WebSocketMessaging;

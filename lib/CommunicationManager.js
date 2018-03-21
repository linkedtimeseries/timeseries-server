const Koa = require('koa');
const Router = require('koa-router');
const WS = require('ws');

class CommunicationManager {
    constructor(config) {
        this._config = config;
        this._app = new Koa();
        this._router = new Router();
        this._webSockets = new Map();
    }

    setupWebSocket(name, port) {
        let websocket = new WS.Server({ port: port });
        this.webSockets.set(name, websocket);
    }

    pushData(name, data) {
        if (this.webSockets.has(name)) {
            this.webSockets.get(name).clients.forEach((client) => {
                //Check if the connection is open
                if (client.readyState === WS.OPEN) {
                    client.send(data);
                }
            });
        } else {
            throw new Error('There is no WebSocket interface defined for ' + name);
        }
    }

    get config() {
        return this._config;
    }

    get app() {
        return this._app;
    }

    get router() {
        return this._router;
    }

    get webSockets() {
        return this._webSockets;
    }
}

module.exports = CommunicationManager;
const Koa = require('koa');
const Router = require('koa-router');
const WS = require('koa-websocket');

class CommunicationManager {
    constructor(config) {
        this._config = config;
        this._app = new Koa();
        this._http = new Router();
        // Websockify the app
        this._app = WS(this.app);
        // New router to handle websocket routes
        this._ws = new Router();
    }

    get config() {
        return this._config;
    }

    get app() {
        return this._app;
    }

    get http() {
        return this._http;
    }

    get ws() {
        return this._ws;
    }
}

module.exports = CommunicationManager;
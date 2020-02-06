const DataEventManager = require('./DataEventManager');

class MultidimensionalInterface {

    constructor(commMan, source) {
        // Communication Manager object
        this._commMan = commMan;
        // Latest piece of data obtained
        this._latestData = null;
        // Subscribe to 'data' events its particular source
        DataEventManager.subscribe(`data-${source}`, (...data) => this.onData(data));

    }

    // Abstract methods to be overridden by interface implementations
    async conData(data) {}

    setupPollInterfaces() {}

    // Websocket interface creator
    setupPubSubInterface(name, port) {
        this.commMan.setupWebSocket(name, port);
    }
    
    get commMan() {
        return this._commMan;
    }

    get latestData() {
        return this._latestData;
    }

    set latestData(data) {
        this._latestData = data;
    }
}

module.exports = MultidimensionalInterface;
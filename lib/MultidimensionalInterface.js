const DataEventManager = require('./DataEventManager');

class MultidimensionalInterface {

    constructor(commMan) {
        // Communication Manager object
        this._commMan = commMan;
        // Latest piece of data obtained
        this._latestData = null;
        // Subscribe to 'data' events 
        DataEventManager.subscribe('data', (...data) => this.onData(data));

    }

    // Abstract methods to be overridden by interface implementations
    onData(data) {}

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
var listeners = new Map();

class DataEventManager {

    subscribe(label, callback) {
        listeners.has(label) || listeners.set(label, []);
        listeners.get(label).push(callback);
    }

    push(label, ...args) {
        let ls = listeners.get(label);

        if (ls && ls.length) {
            ls.forEach((callback) => {
                callback(...args);
            });
            return true;
        }
        return false;
    }
}

module.exports = new DataEventManager;
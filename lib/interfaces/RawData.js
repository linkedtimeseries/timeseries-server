const MultidimensionalInterface = require('../../lib/MultidimensionalInterface');
const Utils = require('../../lib/Utils');
const md5 = require('md5');
const WS = require('ws');

class RawData extends MultidimensionalInterface {

    constructor(config, commMan) {
        // Setup event subscriptions and cx interfaces
        super(commMan, config.name);
        this._hostName = commMan.config.hostName;
        this._liveURI = commMan.config.liveUriPath;
        // Websocket client connections
        this._wss = [];
        // This interface name
        this._name = config.name;
        // In-memory last update utilities and data
        this._lastFragment = null;
        this._latestData = null;
        this._latestRDFStore = null;
        this._lastObserved = null;
        // Data storage utilities
        this._fragmentsPath = config.outputPath + '/' + config.name;
        this._fragmentMaxSize = config.maxFileSize;
        this._byteCounter = 0;
        // Load HTTP interfaces for this instance
        this.setupPollInterfaces();
        // Load Websocket interface
        this.setupPubSubInterface();
        // Init storage folder
        Utils.createFolder(this.fragmentsPath);

        // TODO: see how to deal with extra static triples
        /*this._staticTriplesPath = config.staticTriples;*/
        /*this._staticTriples = null;*/
        /*this._metadata = super.commMan.config.metadata;*/
    }

    async onData(data) {
        this.latestData = data[0];
        this.latestRDFStore = await Utils.getRDFStore(await Utils.jsonld2Rdf(data[0]));
        this.lastObserved = new Date(this.latestRDFStore.getQuads(null, 'http://www.w3.org/ns/sosa/resultTime')[0].object.value);

        // TODO: see how to deal with extra static triples
        /*if (this.staticTriples === null) {
            this.staticTriples = await this.parseStaticData(this.staticTriplesPath);
        }*/

        // Send data to subscribed clients via Websocket (if any)
        if (this.wss.length > 0) {
            this.wss.map(async (ws, index) => {
                if (ws.readyState === WS.OPEN) {
                    ws.send(JSON.stringify(this.latestData));
                } else {
                    // Client no longer connected. Delete reference from array
                    this.wss.splice(index, 1);
                }
            });
        }

        // Store data in files according to config for keeping historic data
        await this.storeData();
    }

    /*async parseStaticData(path) {
        if (path && path !== '') {
            let staticData = await Utils.getTriplesFromFile(path);
            return await Utils.formatQuads('application/trig', staticData[1], staticData[0]);
        } else {
            return '';
        }
    }*/

    setupPollInterfaces() {

        // HTTP interface to get the latest data update
        super.commMan.http.get(this.liveURI + this.name, async (ctx, next) => {
            ctx.response.set({ 'Access-Control-Allow-Origin': '*' });
            if (this.latestData == null) {
                ctx.response.status = 404;
                ctx.response.body = "No data found";
            } else {
                let etag = 'W/"' + md5(this.lastObserved) + '"';
                let ifNoneMatchHeader = ctx.request.header['if-none-match'];
                let last_modified = this.lastObserved.toUTCString();

                if (ifNoneMatchHeader && ifNoneMatchHeader === etag) {
                    ctx.response.status = 304;
                } else {
                    ctx.response.set({
                        'ETag': etag,
                        'Last-Modified': last_modified,
                        'Content-Type': 'application/ld+json'
                    });

                    // TODO: see how to deal with extra static triples
                    /*if(this.staticTriples) {
                        ctx.response.body = this.staticTriples.concat(self.latestData.toString());
                    }*/

                    // TODO: Handle content negotiation

                    ctx.response.body = this.latestData;
                }
            }
        });

        // HTTP interface to get a specific fragment of data (historic data)
        super.commMan.http.get(this.liveURI + this.name + '/fragments', async (ctx, next) => {
            let queryTime = new Date(ctx.query.time);

            if (queryTime.toString() === 'Invalid Date') {
                // Redirect to now time
                ctx.status = 302
                ctx.redirect(this.liveURI + this.name + '/fragments?time=' + new Date().toISOString());
                return;
            }

            let fragments = Utils.getAllFragments(this.fragmentsPath).map(f => new Date(f.substring(0, f.indexOf('.json'))).getTime());
            let [fragment, index] = Utils.dateBinarySearch(queryTime.getTime(), fragments);

            if (queryTime.getTime() !== fragment.getTime()) {
                // Redirect to correct fragment URL
                ctx.status = 302
                ctx.redirect(this.liveURI + this.name + '/fragments?time=' + fragment.toISOString());
                return;
            }

            let responseObj = {
                "@context": {
                    "xsd": "http://www.w3.org/2001/XMLSchema#",
                    "sosa": "http://www.w3.org/ns/sosa/",
                    "hydra": "http://www.w3.org/ns/hydra/core#",
                    "previous": "hydra:previous",
                    "search": "hydra:search",
                    "template": "hydra:template",
                    "mapping": "hydra:mapping",
                    "property": "hydra:property",
                    "variableRepresentation": {
                        "@id": "hydra:variableRepresentation",
                        "@type": "@id"
                    },
                    "variable": {
                        "@id": "hydra:variable",
                        "@type": "xsd:string"
                    },
                    "required": {
                        "@id": "hydra:required",
                        "@type": "xsd:boolean"
                    }
                },
                "@id": this.hostName + this.liveURI + this.name + '/fragments?time=' + fragment.toISOString(),
                "@graph": []
            };

            let fc = Utils.getFragmentsCount(this.fragmentsPath);
            let content = (await Utils.getFileContent(this.fragmentsPath + '/' + fragment.toISOString() + '.json'))
                .split('\n');
            content.pop();
            content = content.map(c => JSON.parse(c)).sort((a, b) => { 
                return new Date(b['lastObserved']).getTime() - new Date(a['lastObserved']).getTime()
            });
            responseObj['@graph'] = content;
            responseObj = this.addMetadata(this.hostName + this.liveURI + this.name + '/fragments', responseObj, fragments, index);

            ctx.response.body = JSON.stringify(responseObj);

            ctx.response.set({
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/ld+json'
            });

            if (index < (fc - 1)) {
                // Cache older fragment that won't change over time
                ctx.response.set({ 'Cache-Control': 'public, max-age=31536000, immutable' });
            } else {
                // Do not cache current fragment as it will get more data
                ctx.response.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate' });
            }
        });
    }

    setupPubSubInterface() {
        super.commMan.ws.get(`/data/live/${this.name}`, (ctx, next) => {
            this.wss.push(ctx.websocket);
        });
    }

    async storeData() {
        if (this.byteCounter === 0 || this.byteCounter > this.fragmentMaxSize) {
            // Create new fragment
            this.lastFragment = this.fragmentsPath + '/' + this.lastObserved.toISOString() + '.json';
            this.byteCounter = 0;
        }

        let string = JSON.stringify(this.latestData)
        await Utils.appendToFile(this.lastFragment, string + '\n');
        let bytes = Buffer.from(string).byteLength;
        this.byteCounter += bytes;
    }

    addMetadata(baseUri, obj, fragments, index) {
        obj['search'] = {
            "@type": "http://www.w3.org/ns/hydra/core#IriTemplate",
            "template": `${baseUri}{?time}`,
            "variableRepresentation": "http://www.w3.org/ns/hydra/core#BasicRepresentation",
            "mapping": {
                "@type": "http://www.w3.org/ns/hydra/core#IriTemplateMapping",
                "variable": "time",
                "required": true,
                "property": "http://www.w3.org/ns/sosa/resultTime"
            }
        }

        if (index > 0) {
            // Adding hydra:previous link
            obj['previous'] = `${baseUri}?time=${new Date(fragments[index - 1]).toISOString()}`;
        }

        return obj;
    }

    get wss() {
        return this._wss;
    }

    get hostName() {
        return this._hostName;
    }

    get liveURI() {
        return this._liveURI;
    }

    get name() {
        return this._name;
    }

    get byteCounter() {
        return this._byteCounter;
    }

    set byteCounter(value) {
        this._byteCounter = value;
    }

    get lastObserved() {
        return this._lastObserved;
    }

    set lastObserved(lo) {
        this._lastObserved = lo;
    }

    get latestData() {
        return this._latestData;
    }

    set latestData(ld) {
        this._latestData = ld;
    }

    get latestRDFStore() {
        return this._latestRDFStore;
    }

    set latestRDFStore(ls) {
        this._latestRDFStore = ls;
    }

    get lastFragment() {
        return this._lastFragment;
    }

    set lastFragment(frg) {
        this._lastFragment = frg;
    }

    get fragmentsPath() {
        return this._fragmentsPath;
    }

    get fragmentMaxSize() {
        return this._fragmentMaxSize;
    }

    get staticTriplesPath() {
        return this._staticTriplesPath;
    }

    get staticTriples() {
        return this._staticTriples;
    }

    set staticTriples(trp) {
        this._staticTriples = trp;
    }

    get metadata() {
        return this._metadata;
    }
}

module.exports = RawData;
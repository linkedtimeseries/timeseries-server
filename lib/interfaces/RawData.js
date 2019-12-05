const MultidimensionalInterface = require('../../lib/MultidimensionalInterface');
const Utils = require('../../lib/Utils');
const md5 = require('md5');
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;

class RawData extends MultidimensionalInterface {

    constructor(config, commMan) {
        super(commMan);
        this._serverUrl = super.commMan.config.serverUrl;
        this._name = config.name;
        this._websocket = config.websocket;
        this._fragmentsPath = config.fragmentsPath;
        this._fragmentMaxSize = config.maxFileSize;
        this._staticTriplesPath = config.staticTriples;
        this._staticTriples = null;
        this._byteCounter = 0;
        this._lastFragment = null;
        this._lastGat = null;
        this._metadata = super.commMan.config.metadata;

        // Load HTTP interfaces for this interface
        this.setupPollInterfaces();

        // Load Websocket interface
        if (this.websocket) {
            super.setupPubSubInterface(this.name, config.wsPort);
        }

        // Init storage folder
        Utils.createFolder(this.fragmentsPath);
    }

    onData(data) {
        if (Array.isArray(data)) {
            data.forEach((_data) => {
                this.init(_data);
            })
        } else {
            this.init(data);
        }
    }

    async parseStaticData(path) {
        if (path && path !== '') {
            let staticData = await Utils.getTriplesFromFile(path);
            return await Utils.formatTriples('application/trig', staticData[1], staticData[0]);
        } else {
            return '';
        }
    }

    async init(data) {
        if (this.staticTriples === null) {
            this.staticTriples = await this.parseStaticData(this.staticTriplesPath);
        }

        this.latestData = data;
        this.lastGat = await Utils.getGeneratedAtTimeValue(this.latestData);

        // If applicable push data to subscribed clients through Websocket
        if (this.websocket) {
            super.commMan.pushData(this.name, this.staticTriples.concat(data.toString()));
        }

        // Store data in files according to config to keep historic data
        this.storeData();
    }

    setupPollInterfaces() {
        let self = this;

        // HTTP interface to get the latest data update
        super.commMan.router.get('/' + this.name + '/latest', async (ctx, next) => {
            ctx.response.set({ 'Access-Control-Allow-Origin': '*' });
            if (self.latestData == null) {
                ctx.response.status = 404;
                ctx.response.body = "No data found";
            } else {
                let etag = 'W/"' + md5(this.lastGat) + '"';
                let ifNoneMatchHeader = ctx.request.header['if-none-match'];
                let last_modified = this.lastGat.toUTCString();
                //let maxage = self.ldfs.calculateMaxAge();
                //let expires = self.ldfs.calculateExpires();

                if (ifNoneMatchHeader && ifNoneMatchHeader === etag) {
                    ctx.response.status = 304;
                } else {
                    ctx.response.set({
                        //'Cache-Control': 'public, s-maxage=' + (maxage - 1) + ', max-age=' + maxage + ', must-revalidate',
                        //'Expires': expires,
                        'ETag': etag,
                        'Last-Modified': last_modified,
                        'Content-Type': 'application/trig'
                    });
                    ctx.response.body = this._staticTriples.concat(self.latestData.toString());
                }
            }
        });

        // HTTP interface to get a specific fragment of data (historic data)
        super.commMan.router.get('/' + this.name + '/fragments', async (ctx, next) => {
            let queryTime = new Date(ctx.query.time);

            if (queryTime.toString() === 'Invalid Date') {
                // Redirect to now time
                ctx.status = 302
                ctx.redirect('/' + this.name + '/fragments?time=' + new Date().toISOString());
                return;
            }

            let fragments = Utils.getAllFragments(this.fragmentsPath).map(f => new Date(f.substring(0, f.indexOf('.trig'))).getTime());
            let [fragment, index] = Utils.dateBinarySearch(queryTime.getTime(), fragments);

            if (queryTime.getTime() !== fragment.getTime()) {
                // Redirect to correct fragment URL
                ctx.status = 302
                ctx.redirect('/' + this.name + '/fragments?time=' + fragment.toISOString());
                return;
            }

            let fc = Utils.getFragmentsCount(this.fragmentsPath);

            let ft = await Utils.getTriplesFromFile(this.fragmentsPath + '/' + fragment.toISOString() + '.trig');
            let fragmentTriples = await Utils.formatTriples('application/trig', ft[1], ft[0]);
            let metaData = await this.createMetadata(fragment, index);

            ctx.response.body = this._staticTriples.concat('\n' + fragmentTriples, '\n' + metaData);

            ctx.response.set({
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'text/turtle'
            });

            if (index < (fc - 1)) {
                // Cache older fragment that won't change over time
                ctx.response.set({ 'Cache-Control': 'public, max-age=31536000, inmutable' });
            } else {
                // Do not cache current fragment as it will get more data
                ctx.response.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate' });
            }
        });
    }

    async storeData() {
        if (this.byteCounter === 0 || this.byteCounter > this.fragmentMaxSize) {
            // Create new fragment
            this.lastFragment = this.fragmentsPath + '/' + this.lastGat.toISOString() + '.trig';
            this.byteCounter = 0;
        }

        await Utils.appendToFile(this.lastFragment, this.latestData.toString());
        let bytes = Buffer.from(this.latestData.toString()).byteLength;
        this.byteCounter += bytes;
    }

    async createMetadata(fragment, index) {
        let baseUri = this.serverUrl + this.name + '/fragments';
        let subject = baseUri + '?time=' + fragment.toISOString();
        let quads = [];

        for (var i = 0; i < Object.keys(this.metadata).length; i++) {
            let key = Object.keys(this.metadata)[i];
            if (key != "@context") {
                if (this.metadata[key]['@type'] === '@id') {
                    quads.push(
                        quad(
                            namedNode(subject),
                            namedNode(Object.keys(this._metadata)[i]),
                            namedNode(this._metadata[Object.keys(this._metadata)[i]]["@value"]),
                            namedNode('#Metadata')
                        )
                    );
                } else {
                    quads.push(
                        quad(
                            namedNode(subject),
                            namedNode(Object.keys(this._metadata)[i]),
                            literal(this._metadata[Object.keys(this._metadata)[i]]["@value"]),
                            namedNode('#Metadata')
                        )
                    );
                }
            }
        }

        // Add Hydra search template
        quads.push(
            quad(
                namedNode(subject),
                namedNode('http://www.w3.org/ns/hydra/core#search'),
                namedNode(subject + '#search'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#search'),
                namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                namedNode('http://www.w3.org/ns/hydra/core#IriTemplate'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#search'),
                namedNode('http://www.w3.org/ns/hydra/core#template'),
                literal(baseUri + '{?time}'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#search'),
                namedNode('http://www.w3.org/ns/hydra/core#variableRepresentation'),
                namedNode('http://www.w3.org/ns/hydra/core#BasicRepresentation'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#search'),
                namedNode('http://www.w3.org/ns/hydra/core#mapping'),
                namedNode(subject + '#mapping'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#mapping'),
                namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                namedNode('http://www.w3.org/ns/hydra/core#IriTemplateMapping'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#mapping'),
                namedNode('http://www.w3.org/ns/hydra/core#variable'),
                literal('time'),
                namedNode('#Metadata')
            )
        );
        quads.push(
            quad(
                namedNode(subject + '#mapping'),
                namedNode('http://www.w3.org/ns/hydra/core#required'),
                literal(true),
                namedNode('#Metadata')
            )
        );

        if (index > 0) {
            // Adding hydra:previous link
            let fragments = Utils.getAllFragments(this.fragmentsPath);
            let previous = fragments[index - 1].substring(0, fragments[index - 1].indexOf('.trig'));
            quads.push(
                quad(
                    namedNode(subject),
                    namedNode('http://www.w3.org/ns/hydra/core#previous'),
                    namedNode(baseUri + '?time=' + previous),
                    namedNode('#Metadata')
                )
            );
        }

        return await Utils.formatTriples('application/trig', quads);
    }

    get serverUrl() {
        return this._serverUrl;
    }

    get name() {
        return this._name;
    }

    get websocket() {
        return this._websocket;
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

    get byteCounter() {
        return this._byteCounter;
    }

    set byteCounter(value) {
        this._byteCounter = value;
    }

    get lastFragment() {
        return this._lastFragment;
    }

    set lastFragment(frg) {
        this._lastFragment = frg;
    }

    get lastGat() {
        return this._lastGat;
    }

    set lastGat(gat) {
        this._lastGat = gat;
    }

    get metadata() {
        return this._metadata;
    }
}

module.exports = RawData;
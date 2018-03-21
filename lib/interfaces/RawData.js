const md5 = require('md5');
const MultidimensionalInterface = require('../../lib/MultidimensionalInterface');
const Utils = require('../../lib/Utils');

class RawData extends MultidimensionalInterface {

    constructor(config, commMan) {
        super(commMan);
        this._serverUrl = super.commMan.config.serverUrl;
        this._name = config.name;
        this._websocket = config.websocket;
        this._fragmentsPath = config.fragmentsPath;
        this._fragmentMaxSize = config.maxFileSize;
        this._staticTriples = config.staticTriples;
        this._byteCounter = 0;
        this._lastFragment = null;
        this._lastGat = null;

        // Load HTTP interfaces for this interface
        this.setupPollInterfaces();

        // Load Websocket interface
        if (this.websocket) {
            super.setupPubsupInterface(this.name, config.wsPort);
        }

        // Init storage folder
        Utils.createFolder(this.fragmentsPath);
    }

    async onData(data) {
        this.latestData = data;
        this.lastGat = await Utils.getGeneratedAtTimeValue(this.latestData);

        // If applicable push data to subscribed clients through Websocket
        if (this.websocket) {
            let staticTriples = await Utils.getTriplesFromFile(this.staticTriples, 'application/trig');
            super.commMan.pushData(this.name, staticTriples.concat(data.toString()));
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

                    let staticTriples = await Utils.getTriplesFromFile(this.staticTriples, 'application/trig');
                    ctx.response.body = staticTriples.concat(self.latestData.toString());
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

            let [fragment, index] = Utils.findFragment(queryTime, this.fragmentsPath);

            if (queryTime.getTime() !== fragment.getTime()) {
                // Redirect to correct fragment URL
                ctx.status = 302
                ctx.redirect('/' + this.name + '/fragments?time=' + fragment.toISOString());
                return;
            }

            let fc = Utils.getFragmentsCount(this.fragmentsPath);
            let staticTriples = await Utils.getTriplesFromFile(this.staticTriples, 'application/trig');
            let fragmentTriples = await Utils.getTriplesFromFile(this.fragmentsPath + '/' + fragment.toISOString() + '.trig', 'application/trig');
            let metaData = await this.createMetadata(fragment, index);
            
            ctx.response.body = staticTriples.concat('\n' + fragmentTriples, '\n' + metaData);

            ctx.response.set({
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/trig'
            });

            if(index < (fc - 1)) {
                // Cache older fragment that won't change over time
                ctx.response.set({'Cache-Control': 'public, max-age=31536000, inmutable'});
            } else {
                // Do not cache current fragment as it will get more data
                ctx.response.set({'Cache-Control': 'no-cache, no-store, must-revalidate'});
            }
        });
    }

    async storeData() {
        if (this.byteCounter === 0 || this.byteCounter > this.fragmentMaxSize) {
            // Create new fragment
            this.lastFragment = this.fragmentsPath + '/' + this.lastGat.toISOString();
            this.byteCounter = 0;
        }

        let bytes = await Utils.writeData(this.latestData.toString(), this.lastFragment);
        this.byteCounter += bytes;
    }

    async createMetadata(fragment, index) {
        let baseUri = this.serverUrl + this.name + '/fragments';
        let subject = baseUri + '?time=' + fragment.toISOString();
        let quads = [];

        quads.push({
            subject: subject,
            predicate: 'http://www.w3.org/2000/01/rdf-schema#label',
            object: '"Historic and real-time parking data in Ghent"',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject,
            predicate: 'http://www.w3.org/2000/01/rdf-schema#comment',
            object: '"This document is a proof of concept mapping using Linked Datex2 by Pieter Colpaert and Julian Rojas"',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject,
            predicate: 'http://xmlns.com/foaf/0.1/homepage',
            object: 'https://github.com/smartflanders/ghent-datex2-to-linkeddata',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject,
            predicate: 'http://creativecommons.org/ns#license',
            object: 'https://data.stad.gent/algemene-licentie',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject,
            predicate: 'http://www.w3.org/ns/hydra/core#search',
            object: subject + '#search',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#search',
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://www.w3.org/ns/hydra/core#IriTemplate',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#search',
            predicate: 'http://www.w3.org/ns/hydra/core#template',
            object: '"' + baseUri + '{?time}"',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#search',
            predicate: 'http://www.w3.org/ns/hydra/core#variableRepresentation',
            object: 'http://www.w3.org/ns/hydra/core#BasicRepresentation',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#search',
            predicate: 'http://www.w3.org/ns/hydra/core#mapping',
            object: subject + '#mapping',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#mapping',
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://www.w3.org/ns/hydra/core#IriTemplateMapping',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#mapping',
            predicate: 'http://www.w3.org/ns/hydra/core#variable',
            object: '"time"',
            graph: '#Metadata'
        });
        quads.push({
            subject: subject + '#mapping',
            predicate: 'http://www.w3.org/ns/hydra/core#required',
            object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
            graph: '#Metadata'
        });

        if (index > 0) {
            // Adding hydra:previous link
            let fragments = Utils.getAllFragments(this.fragmentsPath);
            let previous = fragments[index - 1].substring(0, fragments[index - 1].indexOf('.trig'));
            
            quads.push({
                subject: subject,
                predicate: 'http://www.w3.org/ns/hydra/core#previous',
                object: baseUri + '?time=' + previous,
                graph: '#Metadata'
            });
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

    get staticTriples() {
        return this._staticTriples;
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
}

module.exports = RawData;
const EventEmitter = require('events');
const cron = require('cron');
const fs = require('fs');
const request = require('request');
const RMLMapper = require('./RMLMapper');
const jsonld = require('jsonld');
const jp = require('jsonpath');
const Utils = require('./Utils');

class SourceReader extends EventEmitter {

    constructor(source, liveURI) {
        super();
        this._name = source.name;
        this._sourceUrl = source.sourceUrl;
        this._liveURI = liveURI;
        this._idAlignment = source.idAlignment;
        this._yarrrml = source.mappings;
        this._rml = null;
        this._context = JSON.parse(fs.readFileSync(source.context, 'utf8'));

        // Setup a cron job to poll the API source
        this.startCronJob(source.refreshInterval);
    }

    startCronJob(period) {
        new cron.CronJob({
            cronTime: period,
            onTick: () => {
                this.pollSource();
            },
            start: true
        });
    }

    async pollSource() {
        // Get RML mappings from YARRRML given in config
        if (!this.rml) {
            this.rml = await RMLMapper.yarrrml2rml(this.yarrrml);
        }

        request(this.sourceUrl, async (err, res, body) => {
            if (err) {
                console.error(err);
            } else if (res.statusCode !== 200) {
                console.error(res.statusCode, body);
            } else {
                try {
                    let timestamp = new Date();
                    // TODO: Use content-negotiation to handle data format. Only JSON supported for now.
                    let rawData = JSON.parse(body);

                    // Align Linked Data IDs if specified in config
                    if (this.idAlignment) {
                        this.alignIdentifiers(rawData);
                    }

                    // Use RML to map data
                    let ld = (await RMLMapper.map(this.rml, JSON.stringify(rawData)))['output'];
                    // Transform to JSON-LD using context given in config
                    let jsld = await jsonld.compact(await jsonld.fromRDF(ld, { format: 'application/n-quads' }), this.context);
                    // Compact Blank Nodes
                    jsld['@graph'] = Utils.compactJsonldBlankNodes(jsld['@graph']);
                    // Add an ID for the observation
                    jsld['@id'] = this.liveURI + this.name + '/' + timestamp.toISOString();
                    // Semantic definition
                    jsld['@type'] = 'Observation';
                    // Time metadata
                    jsld['lastObserved'] = timestamp.toISOString();

                    // Emit data event
                    this.emit('data', jsld);
                } catch (err) {
                    console.error(err);
                }
            }
        });
    }

    alignIdentifiers(rawData) {
        let al = this.getAlignmentIndex();
        const nodes = jp.nodes(rawData, this.idAlignment.apiPath);
        for(const node of nodes) {
            const newId = al.get(node.value);
            const fixed = jp.value(rawData, jp.stringify(node.path), newId);
        }
    }

    getAlignmentIndex() {
        let map = new Map();
        for(const r of this.idAlignment.align) {
            map.set(r.value, r['@id']);
        }
        return map;
    }

    get name() {
        return this._name;
    }

    get sourceUrl() {
        return this._sourceUrl;
    }

    get liveURI() {
        return this._liveURI;
    }

    get idAlignment() {
        return this._idAlignment;
    }

    get yarrrml() {
        return this._yarrrml;
    }

    get rml() {
        return this._rml;
    }

    set rml(rml) {
        this._rml = rml;
    }

    get context() {
        return this._context;
    }
}

module.exports = SourceReader;
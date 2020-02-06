const MultidimensionalInterface = require('../../lib/MultidimensionalInterface');
const Utils = require('../../lib/Utils');
const moment = require('moment');

class StatisticalAverage extends MultidimensionalInterface {
    constructor(config, commMan) {
        super(commMan);
        this._serverUrl = super.commMan.config.serverUrl;
        this._name = config.name;
        this._websocket = config.websocket;
        this._fragmentsPath = config.fragmentsPath;
        this._staticTriples = config.staticTriples;
        this._latestGat = null;

        // Init storage folder
        Utils.createFolder(this.fragmentsPath);

        // Load HTTP interfaces for this interface
        this.setupPollInterfaces();

        // Load Websocket interface
        if (this.websocket) {
            super.setupPubsupInterface(this.name, config.wsPort);
        }
    }

    async onData(data) {
        this.latestData = data;
        this.latestGat = moment(await Utils.getGeneratedAtTimeValue(this.latestData));
        let gat = this.latestGat;
        gat.utc();

        let hlevel = await this.handleHourLevel(this.latestData, gat);
        let dlevel = await this.handleDayLevel(hlevel, gat);
        let mlevel = await this.handleMonthLevel(dlevel, gat);
        await this.handleYearLevel(mlevel, gat);

        // If applicable push data to subscribed clients through Websocket
        if (this.websocket) {
            let st = await Utils.getTriplesFromFile(this.staticTriples);
            st[1] = st[1].concat(hlevel[0]);
            let rdf = await Utils.formatQuads('application/trig', st[1], st[0]);
            super.commMan.pushData(this.name, rdf);
        }
    }

    setupPollInterfaces() {
        let self = this;

        super.commMan.router.get('/' + this.name + '/fragment/:year', async (ctx, next) => {
            ctx.response.set({ 'Access-Control-Allow-Origin': '*' });
            let filePath = this.fragmentsPath + '/' + ctx.params.year.split('_')[0] + '.trig';
            await this.handleRequest(ctx, filePath, true);
        });

        super.commMan.router.get('/' + this.name + '/fragment/:year/:month', async (ctx, next) => {
            ctx.response.set({ 'Access-Control-Allow-Origin': '*' });
            let filePath = this.fragmentsPath + '/' + ctx.params.year.split('_')[0] + '-' + ctx.params.month.split('_')[0] + '.trig';
            await this.handleRequest(ctx, filePath, true);
        });

        super.commMan.router.get('/' + this.name + '/fragment/:year/:month/:day', async (ctx, next) => {
            ctx.response.set({ 'Access-Control-Allow-Origin': '*' });
            let filePath = this.fragmentsPath + '/' + ctx.params.year.split('_')[0] + '-' + ctx.params.month.split('_')[0] + '-' 
                + ctx.params.day.split('_')[0] + '.trig';

            await this.handleRequest(ctx, filePath, true);
        });

        super.commMan.router.get('/' + this.name + '/fragment/:year/:month/:day/:hour', async (ctx, next) => {
            ctx.response.set({ 'Access-Control-Allow-Origin': '*' });
            let filePath = this.fragmentsPath + '/' + ctx.params.year.split('_')[0] + '-' + ctx.params.month.split('_')[0] + '-' 
                + ctx.params.day.split('_')[0] + 'T' + ctx.params.hour.split('_')[0] + '.trig';

            await this.handleRequest(ctx, filePath, false);
        });
    }

    async handleRequest(ctx, filePath, metadata) {
        if(!Utils.exists(filePath)) {
            ctx.response.status = 404;
            ctx.response.body = "No data found";
        } else {
            let st = await Utils.getTriplesFromFile(this.staticTriples);
            let ft = await Utils.getTriplesFromFile(filePath);

            if(metadata) {
                let fragmentId = Utils.getTriplesBySPOG(ft[1], null, 'http://www.w3.org/ns/prov#generatedAtTime')[0].subject;
                this.addMetadata(fragmentId, ft[1]);
            }

            ctx.response.set({'Content-Type': 'text/plain'});
            ctx.response.body = await Utils.formatQuads('application/trig', st[1].concat(ft[1]), st[0]);
        }
    }

    async handleHourLevel(rawdata, gat) {
        let hourPath = this.fragmentsPath + '/' + gat.format('YYYY-MM-DDTHH') + '.trig';
        let data = null;
        let values = null;

        if (Utils.exists(hourPath)) {
            let newTriples = (await Utils.getQuadsFromString(rawdata.toString()))[1];
            let storedTriples = (await Utils.getTriplesFromFile(hourPath))[1];
            [data, values] = await this.updateHourFragment(newTriples, storedTriples, gat);
            await Utils.overwriteFile(hourPath, await Utils.formatQuads('application/trig', data));
        } else {
            [data, values] = await this.createHourFragment(gat);
            await Utils.appendToFile(hourPath, await Utils.formatQuads('application/trig', data));
        }

        return [data, values];
    }

    async handleDayLevel(hlevel, gat) {
        let dayPath = this.fragmentsPath + '/' + gat.format('YYYY-MM-DD') + '.trig';
        let data = null;
        let values = null;

        if (Utils.exists(dayPath)) {
            let storedTriples = (await Utils.getTriplesFromFile(dayPath))[1];
            [data, values] = await this.updateFragment(hlevel[1], storedTriples, gat);
            await Utils.overwriteFile(dayPath, await Utils.formatQuads('application/trig', data));
        } else {
            data = this.createDayFragment(hlevel[0], gat);
            values = hlevel[1];
            await Utils.appendToFile(dayPath, await Utils.formatQuads('application/trig', data));
        }

        return [data, values];
    }

    async handleMonthLevel(dlevel, gat) {
        let monthPath = this.fragmentsPath + '/' + gat.format('YYYY-MM') + '.trig';
        let data = null;
        let values = null;

        if (Utils.exists(monthPath)) {
            let storedTriples = (await Utils.getTriplesFromFile(monthPath))[1];
            [data, values] = await this.updateFragment(dlevel[1], storedTriples, gat);
            await Utils.overwriteFile(monthPath, await Utils.formatQuads('application/trig', data));
        } else {
            data = this.createMonthFragment(dlevel[0], gat);
            values = dlevel[1];
            await Utils.appendToFile(monthPath, await Utils.formatQuads('application/trig', data));
        }

        return [data, values];
    }

    async handleYearLevel(mlevel, gat) {
        let yearPath = this.fragmentsPath + '/' + gat.format('YYYY') + '.trig';
        let data = null;
        let values = null;

        if (Utils.exists(yearPath)) {
            let storedTriples = (await Utils.getTriplesFromFile(yearPath))[1];
            [data, values] = await this.updateFragment(mlevel[1], storedTriples, gat);
            await Utils.overwriteFile(yearPath, await Utils.formatQuads('application/trig', data));
        } else {
            data = this.createYearFragment(mlevel[0], gat);
            values = mlevel[1];
            await Utils.appendToFile(yearPath, await Utils.formatQuads('application/trig', data));
        }

        return [data, values];
    }

    async createHourFragment(gat) {
        let tempDate = moment(gat);
        let nextMonth = tempDate.add(1, 'M').format('MM');
        tempDate = moment(gat);
        let nextDay = tempDate.add(1, 'd').format('DD');
        tempDate = moment(gat);
        let nextHour = tempDate.add(1, 'h').format('HH');

        let rangeGate = this.serverUrl + this.name + '/fragment/' + gat.year() + '_' + (gat.year() + 1) + '/'
            + gat.format('MM') + '_' + nextMonth + '/' + gat.format('DD') + '_' + nextDay + '/';
        let fragmentId = rangeGate + gat.format('HH') + '_' + nextHour;
        let quads = (await Utils.getQuadsFromString(this.latestData.toString()))[1];
        let values = new Map();

        tempDate = moment(gat);
        tempDate.minutes(0).seconds(0).milliseconds(0);

        for (let i = 0; i < quads.length; i++) {
            if (quads[i].predicate === 'http://vocab.datex.org/terms#parkingNumberOfVacantSpaces') {
                quads[i].graph = fragmentId;
                quads[i].predicate = 'http://datapiloten.be/vocab/timeseries#mean';
                values.set(quads[i].subject, Utils.getLiteralValue(quads[i].object));
            }

            if (quads[i].predicate === 'http://www.w3.org/ns/prov#generatedAtTime') {
                quads[i].subject = fragmentId;
            }
        }

        quads.push({
            subject: fragmentId,
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://w3id.org/multidimensional-interface/ontology#RangeFragment'
        });
        quads.push({
            subject: fragmentId,
            predicate: 'http://w3id.org/multidimensional-interface/ontology#initial',
            object: '"' + tempDate.toISOString() + '"'
        });
        quads.push({
            subject: fragmentId,
            predicate: 'http://w3id.org/multidimensional-interface/ontology#final',
            object: '"' + tempDate.add(1, 'h').toISOString() + '"'
        });
        quads.push({
            subject: fragmentId,
            predicate: 'http://w3id.org/multidimensional-interface/ontology#hasRangeGate',
            object: rangeGate
        });
        quads.push({
            subject: fragmentId,
            predicate: 'http://datapiloten.be/vocab/timeseries#sampleSize',
            object: '"1"'
        });

        return [quads, values];
    }

    updateHourFragment(newer, old, gat) {
        let newValues = this.getPVFromRawData(newer);
        let sampleTriple = Utils.getTriplesBySPOG(old, null, 'http://datapiloten.be/vocab/timeseries#sampleSize')[0];
        let sampleValue = parseInt(Utils.getLiteralValue(sampleTriple.object));
        let values = new Map();

        for (let i in old) {
            if (old[i].predicate === 'http://datapiloten.be/vocab/timeseries#mean') {
                old[i].object = '"' + this.calculateMean(parseInt(newValues.get(old[i].subject)),
                    parseInt(Utils.getLiteralValue(old[i].object)), sampleValue) + '"';
                values.set(old[i].subject, Utils.getLiteralValue(old[i].object));
            }

            if (old[i].predicate === 'http://www.w3.org/ns/prov#generatedAtTime') {
                old[i].object = '"' + gat.toISOString() + '"';
            }

            if (old[i].predicate === 'http://datapiloten.be/vocab/timeseries#sampleSize') {
                old[i].object = '"' + (sampleValue + 1) + '"';
            }
        }

        return [old, values];
    }

    createDayFragment(hlevel, gat) {
        let tempDate = moment(gat);
        let nextMonth = tempDate.add(1, 'M').format('MM');
        tempDate = moment(gat);
        let nextDay = tempDate.add(1, 'd').format('DD');

        let rangeGate = this.serverUrl + this.name + '/fragment/' + gat.year() + '_' + (gat.year() + 1) + '/'
            + gat.format('MM') + '_' + nextMonth + '/';
        let fragmentId = rangeGate + gat.format('DD') + '_' + nextDay;

        tempDate = moment(gat);
        tempDate.hours(0).minutes(0).seconds(0).milliseconds(0);

        for (let i = 0; i < hlevel.length; i++) {
            if (hlevel[i].graph) {
                hlevel[i].graph = fragmentId;
            } else {
                hlevel[i].subject = fragmentId;
            }

            if (hlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#initial') {
                hlevel[i].object = '"' + tempDate.toISOString() + '"';
            }

            if (hlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#final') {
                hlevel[i].object = '"' + tempDate.add(1, 'd').toISOString() + '"';
            }

            if (hlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#hasRangeGate') {
                hlevel[i].object = rangeGate;
            }

            if (hlevel[i].predicate === 'http://datapiloten.be/vocab/timeseries#sampleSize') {
                hlevel[i].object = '"1"';
            }
        }

        //this.addMetadata(fragmentId, hlevel);

        return hlevel;
    }

    createMonthFragment(dlevel, gat) {
        let tempDate = moment(gat);
        let nextMonth = tempDate.add(1, 'M').format('MM');

        let rangeGate = this.serverUrl + this.name + '/fragment/' + gat.year() + '_' + (gat.year() + 1) + '/';
        let fragmentId = rangeGate + gat.format('MM') + '_' + nextMonth;

        tempDate = moment(gat);
        tempDate.date(1).hours(0).minutes(0).seconds(0).milliseconds(0);

        for (let i = 0; i < dlevel.length; i++) {
            if (dlevel[i].graph) {
                dlevel[i].graph = fragmentId;
            } else {
                dlevel[i].subject = fragmentId;
            }

            if (dlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#initial') {
                dlevel[i].object = '"' + tempDate.toISOString() + '"';
            }

            if (dlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#final') {
                dlevel[i].object = '"' + tempDate.add(1, 'M').toISOString() + '"';
            }

            if (dlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#hasRangeGate') {
                dlevel[i].object = rangeGate;
            }

            if (dlevel[i].predicate === 'http://datapiloten.be/vocab/timeseries#sampleSize') {
                dlevel[i].object = '"1"';
            }
        }

        //this.addMetadata(fragmentId, dlevel);

        return dlevel;
    }

    createYearFragment(mlevel, gat) {
        let tempDate = moment(gat);
        let fragmentId = this.serverUrl + this.name + '/fragment/' + gat.year() + '_' + (gat.year() + 1);

        tempDate.month(0).date(1).hours(0).minutes(0).seconds(0).milliseconds(0);

        for (let i = 0; i < mlevel.length; i++) {
            if (mlevel[i].graph) {
                mlevel[i].graph = fragmentId;
            } else {
                mlevel[i].subject = fragmentId;
            }

            if (mlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#initial') {
                mlevel[i].object = '"' + tempDate.toISOString() + '"';
            }

            if (mlevel[i].predicate === 'http://w3id.org/multidimensional-interface/ontology#final') {
                mlevel[i].object = '"' + tempDate.add(1, 'y').toISOString() + '"';
            }

            if (mlevel[i].predicate === 'http://datapiloten.be/vocab/timeseries#sampleSize') {
                mlevel[i].object = '"1"';
            }
        }

        mlevel = mlevel.filter(m => m.predicate !== 'http://w3id.org/multidimensional-interface/ontology#hasRangeGate');

        //this.addMetadata(fragmentId, mlevel);

        return mlevel;
    }

    updateFragment(newValues, old, gat) {
        let sampleTriple = Utils.getTriplesBySPOG(old, null, 'http://datapiloten.be/vocab/timeseries#sampleSize')[0];
        let sampleValue = parseInt(Utils.getLiteralValue(sampleTriple.object));

        for (let i in old) {
            if (old[i].predicate === 'http://datapiloten.be/vocab/timeseries#mean') {
                old[i].object = '"' + this.calculateMean(parseInt(newValues.get(old[i].subject)),
                    parseInt(Utils.getLiteralValue(old[i].object)), sampleValue) + '"';
                newValues.set(old[i].subject, Utils.getLiteralValue(old[i].object));
            }

            if (old[i].predicate === 'http://www.w3.org/ns/prov#generatedAtTime') {
                old[i].object = '"' + gat.toISOString() + '"';
            }

            if (old[i].predicate === 'http://datapiloten.be/vocab/timeseries#sampleSize') {
                old[i].object = '"' + (sampleValue + 1) + '"';
            }
        }

        return [old, newValues];
    }

    addMetadata(fragmentId, level) {
        level.push({
            subject: fragmentId,
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://w3id.org/multidimensional-interface/ontology#RangeGate'
        });
        level.push({
            subject: fragmentId,
            predicate: 'http://www.w3.org/ns/hydra/core#search',
            object: fragmentId + '#search'
        });
        level.push({
            subject: fragmentId + '#search',
            predicate: 'http://www.w3.org/ns/hydra/core#template',
            object: '"' + fragmentId + '/{+initial_final}' + '"'
        });
        level.push({
            subject: fragmentId + '#search',
            predicate: 'http://www.w3.org/ns/hydra/core#mapping',
            object: '"' + fragmentId + '#mapping' + '"'
        });
        level.push({
            subject: fragmentId + '#mapping',
            predicate: 'http://www.w3.org/ns/hydra/core#variable',
            object: '"initial"'
        });
        level.push({
            subject: fragmentId + '#mapping',
            predicate: 'http://www.w3.org/ns/hydra/core#variable',
            object: '"final"'
        });
        level.push({
            subject: fragmentId + '#mapping',
            predicate: 'http://www.w3.org/ns/hydra/core#property',
            object: 'http://w3id.org/multidimensional-interface/ontology#initial'
        });
        level.push({
            subject: fragmentId + '#mapping',
            predicate: 'http://www.w3.org/ns/hydra/core#property',
            object: 'http://w3id.org/multidimensional-interface/ontology#final'
        });
    }

    getPVFromRawData(triples) {
        let res = new Map();
        for (let i in triples) {
            if (triples[i].predicate === 'http://vocab.datex.org/terms#parkingNumberOfVacantSpaces') {
                res.set(triples[i].subject, Utils.getLiteralValue(triples[i].object));
            }
        }
        return res;
    }

    calculateMean(n, aggregate, sample) {
        return Math.floor(((aggregate * sample) + n) / (sample + 1));
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

    get staticTriples() {
        return this._staticTriples;
    }

    get latestGat() {
        return this._latestGat;
    }

    set latestGat(date) {
        this._latestGat = date;
    }
}

module.exports = StatisticalAverage;
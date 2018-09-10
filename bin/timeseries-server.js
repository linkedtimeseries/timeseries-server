const CommunicationManager = require('../lib/CommunicationManager');
const Configuration = require('../lib/Configuration');
const DataEventManager = require('../lib/DataEventManager');
const N3 = require('n3');

const parser = new N3.Parser();
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;

try {
    // Read config file
    let config = Configuration.getConfig(process.argv);
    // Init Communication Manager module
    let commManager = new CommunicationManager(config);

    // Load multidimensional interfaces
    loadInterfaceModules(config.interfaces, commManager);

    //Listen for data on standard input
    let stdin = process.openStdin();
    stdin.on('data', chunk => writePerObservation(chunk));

    // Launch Web server for polling interfaces
    let app = commManager.app;
    let router = commManager.router;
    app.use(router.routes()).use(router.allowedMethods());
    app.listen(config.httpPort);

} catch (e) {
    console.error(e);
    process.exit(1);
}

function loadInterfaceModules(interfaces, commManager) {
    for (let i in interfaces) {
        let Interface = require(interfaces[i].path);
        new Interface(interfaces[i], commManager);
    }
}

function writePerObservation(chunk) {
    const store = new N3.Store();

    // Split chunk into observations
    parser.parse(chunk.toString('utf8'), (error, quad, prefixes) => {
        if (quad) {
            store.addQuad(quad);
        }
        else {
            // All quads parsed and stored
            // Retrieve distinct observations by generatedAtTime
            const observations = store.getQuads(null, N3.DataFactory.namedNode('http://www.w3.org/ns/prov#generatedAtTime'), null);
            observations.forEach((observation) => {
                const writer = new N3.Writer({});

                // Get observation
                let quadsByObservation = store.getQuads(null, null, null, observation.subject.value);
                // Get provenance about observation
                let provObservation = store.getQuads(observation.subject.value, null, null, null);

                writer.addQuads(quadsByObservation);
                writer.addQuads(provObservation);
                writer.end((error, result) => {
                    // Launch data event towards predifined interfaces through Data Event Manager module
                    DataEventManager.push('data', result);
                });
            });
        }
    });
}
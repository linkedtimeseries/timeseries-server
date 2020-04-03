const CommunicationManager = require('../lib/CommunicationManager');
const Configuration = require('../lib/Configuration');
const SourceReader = require('../lib/SourceReader');
const DataEventManager = require('../lib/DataEventManager');

try {
    // Read config file
    let config = Configuration.getConfig(process.argv);
    // Init Communication Manager module
    let commManager = new CommunicationManager(config);

    // Process data source
    for (let i in config.sources) {

        // Load multidimensional interfaces
        loadInterfaceModules(config.sources[i], commManager);

        let source = new SourceReader(config.sources[i], config.hostName + config.liveUriPath);
        source.on('data', data => {
            console.log(`${new Date().toISOString()} – data mapped from ${config.sources[i].name}`);
            // Launch data event towards predefined interfaces through Data Event Manager module
            DataEventManager.push(`data-${config.sources[i].name}`, data);
        });
    }

    // TODO: Define a way to configure RDF input streams
    // Listen for data on standard input
    // let stdin = process.openStdin();
    // stdin.on('data', chunk => writePerObservation(chunk));

    // Launch Web server for polling interfaces
    let app = commManager.app;
    let http = commManager.http;
    let ws = commManager.ws;
    app.use(http.routes()).use(http.allowedMethods());
    app.ws.use(ws.routes()).use(ws.allowedMethods());
    app.listen(config.httpPort);

} catch (e) {
    console.error(e);
    process.exit(1);
}

function loadInterfaceModules(source, commManager) {
    let int = Object.keys(source.interfaces);
    for (let i in int) {
        let Interface = require(process.cwd() + '/' + source.interfaces[int[i]]);
        new Interface(source, commManager);
    }
}
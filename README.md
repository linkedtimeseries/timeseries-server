# Time Series server

The Live Time Series Server is an ongoing implementation that aims on providing a cost efficient interface for 
Open Stream data publishing. Through an extensible modular architecture we allow data publishers to define 
multidimensional interfaces to provide query answering functionalities on top of their data.

![Server Architecture](https://linkedtimeseries.github.io/timeseries-demo-paper/media/images/fig1.png)

Features:

 * Allows to define custom interfaces to publish pre-processed summaries of the data.
 * Modular and extensible architecture for implementig new features.
 * Keeps and publishes history over HTTP using appropriate caching headers.
 * Can expose HTTP and Websocket interfaces for communication with clients.

A more detailed description can be found on this [demo paper](https://linkedtimeseries.github.io/timeseries-demo-paper/).

## Installation
Clone this repository and run `npm install` to install all necessary modules.

## Configuration
An example configuration file ([config.json](https://github.com/linkedtimeseries/timeseries-server/blob/master/config.json)) 
is provided. This file defines the main communication parameters of the server and as an example, also defines 3 different 
multidimensional interfaces (RawData, StatisticalAverage and GeographicClassification). The main parameters are:
```js
{
  "serverUrl": "http://localhost:8080/", // Web server main URL.
  "httpPort": 8080, // Web server access port.
  "interfaces": [...] // Multidimensional interfaces specification.
}
```

### RawData
This is the default interface for the server as it takes the received stream updates and exposes them without any modification.
This interface allows also to store historic data as [Linked Data fragments](http://linkeddatafragments.org/). For this example 
the data is exposed through HTTP using `/RawData/latest` URL for the most updated data and `/RawData/fragments{?time}` URL 
to access historic data. It also exposes an optional Websocket interface to push the latest updates to subscribed clients. 
Each interface can define its configuration parameters according to their needs. for this specific implementation these are
the defined parameters:
```js
{
  "name": "RawData", // Interface name. Used to define the HTTP URLs.
  "path": "../lib/interface/RawData", // Path to the interface javascript implementation. Used to dynamic module loading.
  "websocket": true, // Determines if a Websocket interface will be exposed.
  "wsPort": 3001, // Port for Websocket interface.
  "fragmentsPath": "./example/data/RawData", // Path to the folder where the historic data will be stored.
  "staticTriples": "./example/data/rawdata_static.trig", // Static triples to be aggregated to the data stream.
  "maxFileSize": 100000 // Maximun size in Bytes of each historic data fragment. 
}
```

## Test it
To test the server a RDF stream can be piped into the server. An RDF stream object is a named graph with elements as follows:
```
<a> <b> <c> <graph1> .
<...> <...> <...> <graph1> .
<graph1> prov:generatedAtTime "2018-..." .
```
As an example we provide a set of around one hour of parking availability [observations](https://github.com/linkedtimeseries/timeseries-server/blob/master/parking_data.trig) 
(made every 30 seconds) for the city of Ghent. We can pipe this file into the server using the [replay-timeseries](https://www.npmjs.com/package/replay-timeseries)
tool, which allows to control the frequency of the updates. Follow the next steps to test the server after installation:
```bash
$ cd timeseries-server
$ npm install -g replay-timeseries
$ cat parking_data.trig | replay-timeseries -s 10x | node bin/timeseries-server.js -c config.json
```
As the original observations were made every 30 seconds, we use `replay-timeseries -s 10x` to replay them every 3 seconds 
(10 times faster). This tool also rewrites the `prov:generatedAtTime` value to the current time for testing purposes. 
Now, to access the data you can use a polling approach through HTTP as follows:
```bash
$ curl -v http://localhost:8080/RawData/latest # Will return the latest stream update.
$ curl -v -L http://localhost:8080/RawData/fragments # Will redirect to the most recent data fragment.
$ curl -v -L http://localhost:8080/RawData/fragments?time=2018-03-20T10:15:00.000Z # Will redirect to the fragment containing observations starting on the given time 
```
Each fragment contains [hydra](http://www.hydra-cg.com/spec/latest/core/) metadata to link to previous data fragment.

To access the data through Websockets you can execute the example Websocket [client](https://github.com/linkedtimeseries/timeseries-server/blob/master/lib/WebSocketClient.js) 
provided on this implementation as follows:
```bash
$ cd timeseries-server
$ node lib/WebSocketClient.js
```
It will print on console the data it receives from the server.

## Authors
Julian Rojas - julianandres.rojasmelendez@ugent.be  
Pieter Colpaert - pieter.colpaert@ugent.be

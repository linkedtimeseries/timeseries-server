const WebSocket = require('ws');

//Create websocket and connect to the server
const ws = new WebSocket('ws://localhost:3001');

//When the client receive a message, print out the data
ws.on('message', data => {
    console.log(data.toString());
});

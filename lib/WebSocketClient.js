const WebSocketStream = require('websocket-stream');

var ws = WebSocketStream('ws://localhost:3001');
process.stdin.pipe(ws)
ws.pipe(process.stdout)
// Test stub for @modelcontextprotocol/sdk: newline-JSON over stdio, nothing else.
// A request {id, method, params} gets {id, result} on stdout; mcp.notification(n) writes n.
const readline = require('readline');

exports.Server = class Server {
  constructor() { this.handlers = {}; }
  setRequestHandler(schema, fn) { this.handlers[schema.method] = fn; }
  async notification(n) { process.stdout.write(JSON.stringify(n) + '\n'); }
  async connect() {
    readline.createInterface({ input: process.stdin }).on('line', async (line) => {
      const msg = JSON.parse(line);
      const result = await this.handlers[msg.method](msg);
      process.stdout.write(JSON.stringify({ id: msg.id, result }) + '\n');
    });
  }
};

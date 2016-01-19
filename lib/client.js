
/**
 * Module dependencies.
 */

var parser = require('socket.io-parser');
var debug = require('debug')('socket.io:client');

/**
 * Client constructor.
 *
 * @param {Server} server instance
 * @param {Socket} connection
 * @api private
 */

class Client {

constructor(server, conn) {
  this.server = server;
  this.conn = conn;
  this.encoder = new parser.Encoder();
  this.decoder = new parser.Decoder();
  this.id = conn.id;
  this.request = conn.request;
  this.setup();
  this.sockets = {};
  this.nsps = {};
  this.connectBuffer = [];
}

/**
 * Sets up event listeners.
 *
 * @api private
 */

setup() {
  this.onclose = this.onclose.bind(this);
  this.ondata = this.ondata.bind(this);
  this.onerror = this.onerror.bind(this);
  this.ondecoded = this.ondecoded.bind(this);

  this.decoder.on('decoded', this.ondecoded);
  this.conn.on('data', this.ondata);
  this.conn.on('error', this.onerror);
  this.conn.on('close', this.onclose);
}

/**
 * Connects a client to a namespace.
 *
 * @param {String} namespace name
 * @api private
 */

connect(name) {
  debug(`connecting to namespace ${name}`);
  let nsp = this.server.nsps[name];
  if (!nsp) {
    this.packet({ type: parser.ERROR, nsp: name, data : 'Invalid namespace'});
    return;
  }

  if ('/' != name && !this.nsps['/']) {
    this.connectBuffer.push(name);
    return;
  }

  let socket = nsp.add(this, () => {
    this.sockets[socket.id] = socket;
    this.nsps[nsp.name] = socket;

    if ('/' == nsp.name && this.connectBuffer.length > 0) {
      this.connectBuffer.forEach(this.connect, this);
      this.connectBuffer = [];
    }
  });
}

/**
 * Disconnects from all namespaces and closes transport.
 *
 * @api private
 */

disconnect() {
  for (let id in this.sockets) {
    if (this.sockets.hasOwnProperty(id)) {
      this.sockets[id].disconnect();
    }
  }
  this.sockets = {};
  this.close();
}

/**
 * Removes a socket. Called by each `Socket`.
 *
 * @api private
 */

remove(socket) {
  if (this.sockets.hasOwnProperty(socket.id)) {
    let nsp = this.sockets[socket.id].nsp.name;
    delete this.sockets[socket.id];
    delete this.nsps[nsp];
  } else {
    debug(`ignoring remove for ${socket.id}`);
  }
}

/**
 * Closes the underlying connection.
 *
 * @api private
 */

close() {
  if ('open' == this.conn.readyState) {
    debug('forcing transport close');
    this.conn.close();
    this.onclose('forced server close');
  }
}

/**
 * Writes a packet to the transport.
 *
 * @param {Object} packet object
 * @param {Object} options
 * @api private
 */

packet(packet, opts) {
  opts = opts || {};

  // this writes to the actual connection
  let writeToEngine = (encodedPackets) => {
    if (opts.volatile && !this.conn.transport.writable) return;
    for (let i = 0; i < encodedPackets.length; i++) {
      this.conn.write(encodedPackets[i], { compress: opts.compress });
    }
  }

  if ('open' == this.conn.readyState) {
    debug(`writing packet ${packet}`);
    if (!opts.preEncoded) { // not broadcasting, need to encode
      this.encoder.encode(packet, writeToEngine); // encode, then write results to engine
    } else { // a broadcast pre-encodes a packet
      writeToEngine(packet);
    }
  } else {
    debug(`ignoring packet write ${packet}`);
  }
}

/**
 * Called with incoming transport data.
 *
 * @api private
 */

ondata(data) {
  // try/catch is needed for protocol violations (GH-1880)
  try {
    this.decoder.add(data);
  } catch(e) {
    this.onerror(e);
  }
}

/**
 * Called when parser fully decodes a packet.
 *
 * @api private
 */

ondecoded(packet) {
  if (parser.CONNECT == packet.type) {
    this.connect(packet.nsp);
  } else {
    let socket = this.nsps[packet.nsp];
    if (socket) {
      socket.onpacket(packet);
    } else {
      debug(`no socket for namespace ${packet.nsp}`);
    }
  }
}

/**
 * Handles an error.
 *
 * @param {Objcet} error object
 * @api private
 */

onerror(err) {
  for (let id in this.sockets) {
    if (this.sockets.hasOwnProperty(id)) {
      this.sockets[id].onerror(err);
    }
  }
  this.onclose('client error');
}

/**
 * Called upon transport close.
 *
 * @param {String} reason
 * @api private
 */

onclose(reason) {
  debug(`client close with reason ${reason}`);

  // ignore a potential subsequent `close` event
  this.destroy();

  // `nsps` and `sockets` are cleaned up seamlessly
  for (let id in this.sockets) {
    if (this.sockets.hasOwnProperty(id)) {
      this.sockets[id].onclose(reason);
    }
  }
  this.sockets = {};

  this.decoder.destroy(); // clean up decoder
}

/**
 * Cleans up event listeners.
 *
 * @api private
 */

destroy() {
  this.conn.removeListener('data', this.ondata);
  this.conn.removeListener('error', this.onerror);
  this.conn.removeListener('close', this.onclose);
  this.decoder.removeListener('decoded', this.ondecoded);
}

}

/**
 * Module exports.
 */

module.exports = Client;

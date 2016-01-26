
/**
 * Module dependencies.
 */

const Emitter = require('events').EventEmitter;
const parser = require('socket.io-parser');
const url = require('url');
const debug = require('debug')('socket.io:socket');
const hasBin = require('has-binary');

/**
 * `EventEmitter#emit` reference.
 */

const emit = Emitter.prototype.emit;

/**
 * Interface to a `Client` for a given `Namespace`.
*/

class Socket extends Emitter {

/**
 * Socket constructor.
 *
 * @param {Namespace} nsp
 * @param {Client} client
 * @api public
 */

constructor(nsp, client) {
  super();
  this.nsp = nsp;
  this.server = nsp.server;
  this.adapter = this.nsp.adapter;
  this.id = `${nsp.name}#${client.id}`;
  this.client = client;
  this.conn = client.conn;
  this.rooms = {};
  this.acks = {};
  this.connected = true;
  this.disconnected = false;
  this.handshake = this.buildHandshake();
}

/**
 * Apply flags from `Socket`.
 */

setFlag(flag) {
  this.flags = this.flags || {};
  this.flags[flag] = true;
  return this;
}

get json()       { return this.setFlag("json"); }
get "volatile"() { return this.setFlag("volatile"); }
get broadcast()  { return this.setFlag("broadcast"); }

/**
 * `request` engine.io shorcut.
 *
 * @api public
 */

get request() {
  return this.conn.request;
}

/**
 * Builds the `handshake` BC object
 *
 * @api private
 */

buildHandshake() {
  return {
    headers: this.request.headers,
    time: `${new Date}`,
    address: this.conn.remoteAddress,
    xdomain: !!this.request.headers.origin,
    secure: !!this.request.connection.encrypted,
    issued: +(new Date),
    url: this.request.url,
    query: url.parse(this.request.url, true).query || {}
  };
}

/**
 * Emits to this client.
 *
 * @return {Socket} self
 * @api public
 */

emit(...args) {
  if (~exports.events.indexOf(args[0])) {
    emit.apply(this, args);
    return this;
  }
  let packet = {
    type: hasBin(args) ? parser.BINARY_EVENT : parser.EVENT,
    data: Array.from(args)
  };
  const flags = this.flags || {};
  const ackCallback = typeof packet.data[packet.data.length-1] === "function" ? packet.data.pop() : undefined;
  
  if (this._rooms || flags.broadcast) {
    if (ackCallback) {
      throw new Error("Callbacks are not supported when broadcasting");
    }
    this.adapter.broadcast(packet, {
      except: [this.id],
      rooms: this._rooms,
      flags: flags
    });
  }
  else {
    if (ackCallback) {
      debug(`emitting packet with ack id ${this.nsp.ids}`);
      this.acks[this.nsp.ids] = ackCallback;
      packet.id = this.nsp.ids++;
    }
    this.packet(packet, {
      volatile: flags.volatile,
      compress: flags.compress
    });
  }
  delete this._rooms;
  delete this.flags;
  return this;
}

/**
 * Targets a room when broadcasting.
 *
 * @param {String} name
 * @return {Socket} self
 * @api public
 */

to(name) {
  this._rooms = this._rooms || [];
  if (!~this._rooms.indexOf(name)) this._rooms.push(name);
  return this;
}

/**
 * Sends a `message` event.
 *
 * @return {Socket} self
 * @api public
 */

send() {
  const args = Array.prototype.slice.call(arguments);
  args.unshift('message');
  this.emit.apply(this, args);
  return this;
}

/**
 * Writes a packet.
 *
 * @param {Object} packet object
 * @param {Object} options
 * @api private
 */

packet(packet, opts) {
  packet.nsp = this.nsp.name;
  opts = opts || {};
  opts.compress = false !== opts.compress;
  this.client.packet(packet, opts);
}

/**
 * Joins a room.
 *
 * @param {String} room
 * @param {Function} optional, callback
 * @return {Socket} self
 * @api private
 */

join(room, fn) {
  debug(`joining room ${room}`);
  if (this.rooms.hasOwnProperty(room)) {
    fn && fn(null);
    return this;
  }
  this.adapter.add(this.id, room, err => {
    if (err) return fn && fn(err);
    debug(`joined room ${room}`);
    this.rooms[room] = room;
    fn && fn(null);
  });
  return this;
}

/**
 * Leaves a room.
 *
 * @param {String} room
 * @param {Function} optional, callback
 * @return {Socket} self
 * @api private
 */

leave(room, fn) {
  debug(`leave room ${room}`);
  this.adapter.del(this.id, room, err => {
    if (err) return fn && fn(err);
    debug(`left room ${room}`);
    delete this.rooms[room];
    fn && fn(null);
  });
  return this;
}

/**
 * Leave all rooms.
 *
 * @api private
 */

leaveAll() {
  this.adapter.delAll(this.id);
  this.rooms = {};
}

/**
 * Called by `Namespace` upon succesful
 * middleware execution (ie: authorization).
 *
 * @api private
 */

onconnect() {
  debug('socket connected - writing packet');
  this.nsp.connected[this.id] = this;
  this.join(this.id);
  this.packet({ type: parser.CONNECT });
}

/**
 * Called with each packet. Called by `Client`.
 *
 * @param {Object} packet
 * @api private
 */

onpacket(packet) {
  debug(`got packet ${packet}`);
  switch (packet.type) {
    case parser.EVENT:
      this.onevent(packet);
      break;

    case parser.BINARY_EVENT:
      this.onevent(packet);
      break;

    case parser.ACK:
      this.onack(packet);
      break;

    case parser.BINARY_ACK:
      this.onack(packet);
      break;

    case parser.DISCONNECT:
      this.ondisconnect();
      break;

    case parser.ERROR:
      this.emit('error', packet.data);
  }
}

/**
 * Called upon event packet.
 *
 * @param {Object} packet object
 * @api private
 */

onevent(packet) {
  const args = packet.data || [];
  debug(`emitting event ${args}`);

  if (null != packet.id) {
    debug('attaching ack callback to event');
    args.push(this.ack(packet.id));
  }

  emit.apply(this, args);
}

/**
 * Produces an ack callback to emit with an event.
 *
 * @param {Number} packet id
 * @api private
 */

ack(id) {
  let sent = false;
  return (...args) => {
    // prevent double callbacks
    if (sent) return;
    const argsCopy = Array.prototype.slice.call(args);
    debug(`sending ack ${argsCopy}`);

    const type = hasBin(argsCopy) ? parser.BINARY_ACK : parser.ACK;
    this.packet({
      id: id,
      type: type,
      data: argsCopy
    });

    sent = true;
  };
}

/**
 * Called upon ack packet.
 *
 * @api private
 */

onack(packet) {
  const ack = this.acks[packet.id];
  if ('function' == typeof ack) {
    debug(`calling ack ${packet.id} with ${packet.data}`);
    ack.apply(this, packet.data);
    delete this.acks[packet.id];
  } else {
    debug(`bad ack ${packet.id}`);
  }
}

/**
 * Called upon client disconnect packet.
 *
 * @api private
 */

ondisconnect() {
  debug('got disconnect packet');
  this.onclose('client namespace disconnect');
}

/**
 * Handles a client error.
 *
 * @api private
 */

onerror(err) {
  if (this.listeners('error').length) {
    this.emit('error', err);
  } else {
    console.error('Missing error handler on `socket`.');
    console.error(err.stack);
  }
}

/**
 * Called upon closing. Called by `Client`.
 *
 * @param {String} reason
 * @param {Error} optional error object
 * @api private
 */

onclose(reason) {
  if (!this.connected) return this;
  debug(`closing socket - reason ${reason}`);
  this.leaveAll();
  this.nsp.remove(this);
  this.client.remove(this);
  this.connected = false;
  this.disconnected = true;
  delete this.nsp.connected[this.id];
  this.emit('disconnect', reason);
}

/**
 * Produces an `error` packet.
 *
 * @param {Object} error object
 * @api private
 */

error(err) {
  this.packet({ type: parser.ERROR, data: err });
}

/**
 * Disconnects this client.
 *
 * @param {Boolean} if `true`, closes the underlying connection
 * @return {Socket} self
 * @api public
 */

disconnect(close) {
  if (!this.connected) return this;
  if (close) {
    this.client.disconnect();
  } else {
    this.packet({ type: parser.DISCONNECT });
    this.onclose('server namespace disconnect');
  }
  return this;
}

/**
 * Sets the compress flag.
 *
 * @param {Boolean} if `true`, compresses the sending data
 * @return {Socket} self
 * @api public
 */

compress(compress) {
  this.flags = this.flags || {};
  this.flags.compress = compress;
  return this;
}

}

Socket.prototype["in"] = Socket.prototype["to"];
Socket.prototype["write"] = Socket.prototype["send"];

/**
 * Module exports.
 */

module.exports = exports = Socket;

/**
 * Blacklisted events.
 *
 * @api public
 */

exports.events = [
  'error',
  'connect',
  'disconnect',
  'newListener',
  'removeListener'
];

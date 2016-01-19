
/**
 * Module dependencies.
 */

const http = require('http');
const read = require('fs').readFileSync;
const parse = require('url').parse;
const engine = require('engine.io');
const client = require('socket.io-client');
const clientVersion = require('socket.io-client/package').version;
const Client = require('./client');
const Namespace = require('./namespace');
const Adapter = require('socket.io-adapter');
const debug = require('debug')('socket.io:server');
const url = require('url');

/**
 * Socket.IO client source.
 */

const clientSource = read(require.resolve('socket.io-client/socket.io.js'), 'utf-8');

class Server {

/**
 * Server constructor.
 *
 * @param {http.Server|Number|Object} http server, port or options
 * @param {Object} options
 * @api public
 */

constructor(srv, opts) {
  if (!(this instanceof Server)) return new Server(srv, opts);
  if ('object' == typeof srv && !srv.listen) {
    opts = srv;
    srv = null;
  }
  opts = opts || {};
  this.nsps = {};
  this.path(opts.path || '/socket.io');
  this.serveClient(false !== opts.serveClient);
  this.adapter(opts.adapter || Adapter);
  this.origins(opts.origins || '*:*');
  this.sockets = this.of('/');
  if (srv) this.attach(srv, opts);
}

/**
 * Server request verification function, that checks for allowed origins
 *
 * @param {http.IncomingMessage} request
 * @param {Function} callback to be called with the result: `fn(err, success)`
 */

checkRequest(req, fn) {
  let origin = req.headers.origin || req.headers.referer;

  // file:// URLs produce a null Origin which can't be authorized via echo-back
  if ('null' == origin || null == origin) origin = '*';

  if (!!origin && typeof(this._origins) == 'function') return this._origins(origin, fn);
  if (this._origins.indexOf('*:*') !== -1) return fn(null, true);
  if (origin) {
    try {
      const parts = url.parse(origin);
      const defaultPort = 'https:' == parts.protocol ? 443 : 80;
      parts.port = parts.port != null
        ? parts.port
        : defaultPort;
      const ok =
        ~this._origins.indexOf(`${parts.hostname}:${parts.port}`) ||
        ~this._origins.indexOf(`${parts.hostname}:*`) ||
        ~this._origins.indexOf(`*:${parts.port}`);
      return fn(null, !!ok);
    } catch (ex) {
    }
  }
  fn(null, false);
}

/**
 * Sets/gets whether client code is being served.
 *
 * @param {Boolean} whether to serve client code
 * @return {Server|Boolean} self when setting or value when getting
 * @api public
 */

serveClient(v) {
  if (!arguments.length) return this._serveClient;
  this._serveClient = v;
  return this;
}

/**
 * Backwards compatiblity.
 *
 * @api public
 */

set(key, val) {
  /**
   * Old settings for backwards compatibility
   */

  const oldSettings = {
    "transports": "transports",
    "heartbeat timeout": "pingTimeout",
    "heartbeat interval": "pingInterval",
    "destroy buffer size": "maxHttpBufferSize"
  };

  if ('authorization' == key && val) {
    this.use((socket, next) => {
      val(socket.request, (err, authorized) => {
        if (err) return next(new Error(err));
        if (!authorized) return next(new Error('Not authorized'));
        next();
      });
    });
  } else if ('origins' == key && val) {
    this.origins(val);
  } else if ('resource' == key) {
    this.path(val);
  } else if (oldSettings[key] && this.eio[oldSettings[key]]) {
    this.eio[oldSettings[key]] = val;
  } else {
    console.error(`Option ${key} is not valid. Please refer to the README.`);
  }

  return this;
}

/**
 * Sets the client serving path.
 *
 * @param {String} pathname
 * @return {Server|String} self when setting or value when getting
 * @api public
 */

path(v) {
  if (!arguments.length) return this._path;
  this._path = v.replace(/\/$/, '');
  return this;
}

/**
 * Sets the adapter for rooms.
 *
 * @param {Adapter} pathname
 * @return {Server|Adapter} self when setting or value when getting
 * @api public
 */

adapter(v) {
  if (!arguments.length) return this._adapter;
  this._adapter = v;
  for (let i in this.nsps) {
    if (this.nsps.hasOwnProperty(i)) {
      this.nsps[i].initAdapter();
    }
  }
  return this;
}

/**
 * Sets the allowed origins for requests.
 *
 * @param {String} origins
 * @return {Server|Adapter} self when setting or value when getting
 * @api public
 */

origins(v) {
  if (!arguments.length) return this._origins;

  this._origins = v;
  return this;
}

/**
 * Attaches socket.io to a server or port.
 *
 * @param {http.Server|Number} server or port
 * @param {Object} options passed to engine.io
 * @return {Server} self
 * @api public
 */

attach(srv, opts) {
  if ('function' == typeof srv) {
    const msg = 'You are trying to attach socket.io to an express ' +
    'request handler function. Please pass a http.Server instance.';
    throw new Error(msg);
  }

  // handle a port as a string
  if (Number(srv) == srv) {
    srv = Number(srv);
  }

  if ('number' == typeof srv) {
    debug(`creating http server and binding to ${srv}`);
    const port = srv;
    srv = http.Server((req, res) => {
      res.writeHead(404);
      res.end();
    });
    srv.listen(port);

  }

  // set engine.io path to `/socket.io`
  opts = opts || {};
  opts.path = opts.path || this.path();
  // set origins verification
  opts.allowRequest = opts.allowRequest || this.checkRequest.bind(this);

  // initialize engine
  debug(`creating engine.io instance with opts ${opts}`);
  this.eio = engine.attach(srv, opts);

  // attach static file serving
  if (this._serveClient) this.attachServe(srv);

  // Export http server
  this.httpServer = srv;

  // bind to engine events
  this.bind(this.eio);

  return this;
}

/**
 * Attaches the static file serving.
 *
 * @param {Function|http.Server} http server
 * @api private
 */

attachServe(srv) {
  debug('attaching client serving req handler');
  const url = `${this._path}/socket.io.js`;
  const evs = srv.listeners('request').slice(0);
  srv.removeAllListeners('request');
  srv.on('request', (req, res) => {
    if (0 === req.url.indexOf(url)) {
      this.serve(req, res);
    } else {
      for (let i = 0; i < evs.length; i++) {
        evs[i].call(srv, req, res);
      }
    }
  });
}

/**
 * Handles a request serving `/socket.io.js`
 *
 * @param {http.Request} req
 * @param {http.Response} res
 * @api private
 */

serve(req, res) {
  const etag = req.headers['if-none-match'];
  if (etag) {
    if (clientVersion == etag) {
      debug('serve client 304');
      res.writeHead(304);
      res.end();
      return;
    }
  }

  debug('serve client source');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('ETag', clientVersion);
  res.writeHead(200);
  res.end(clientSource);
}

/**
 * Binds socket.io to an engine.io instance.
 *
 * @param {engine.Server} engine.io (or compatible) server
 * @return {Server} self
 * @api public
 */

bind(engine) {
  this.engine = engine;
  this.engine.on('connection', this.onconnection.bind(this));
  return this;
}

/**
 * Called with each incoming transport connection.
 *
 * @param {engine.Socket} socket
 * @return {Server} self
 * @api public
 */

onconnection(conn) {
  debug(`incoming connection with id ${conn.id}`);
  const client = new Client(this, conn);
  client.connect('/');
  return this;
}

/**
 * Looks up a namespace.
 *
 * @param {String} nsp name
 * @param {Function} optional, nsp `connection` ev handler
 * @api public
 */

of(name, fn) {
  if (String(name)[0] !== '/') name = `/${name}`

  let nsp = this.nsps[name];
  if (!nsp) {
    debug(`initializing namespace ${name}`);
    nsp = new Namespace(this, name);
    this.nsps[name] = nsp;
  }
  if (fn) nsp.on('connect', fn);
  return nsp;
}

/**
 * Closes server connection
 *
 * @api public
 */

close() {
  for (let id in this.nsps['/'].sockets) {
    if (this.nsps['/'].sockets.hasOwnProperty(id)) {
      this.nsps['/'].sockets[id].onclose();
    }
  }

  this.engine.close();

  if(this.httpServer){
    this.httpServer.close();
  }
}

}

Server.prototype["listen"] = Server.prototype.attach;

/**
 * Expose main namespace (/).
 */

['on', 'to', 'in', 'use', 'emit', 'send', 'write', 'clients', 'compress'].forEach(fn => {
  Server.prototype[fn] = function(){
    const nsp = this.sockets[fn];
    return nsp.apply(this.sockets, arguments);
  };
});

Namespace.flags.forEach(flag => {
  Server.prototype.__defineGetter__(flag, function(){
    this.sockets.flags = this.sockets.flags || {};
    this.sockets.flags[flag] = true;
    return this;
  });
});

/**
 * BC with `io.listen`
 */

Server.listen = Server;

/**
 * Module exports.
 */

module.exports = Server;

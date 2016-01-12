
var http = require('http').Server;
var io = require('..');
var fs = require('fs');
var join = require('path').join;
var ioc = require('socket.io-client');
var request = require('supertest');
var expect = require('expect.js');

// Creates a socket.io client for the given server
function client(srv, nsp, opts){
  if ('object' == typeof nsp) {
    opts = nsp;
    nsp = null;
  }
  let addr = srv.address();
  if (!addr) addr = srv.listen().address();
  let url = 'ws://localhost:' + addr.port + (nsp || '');
  return ioc(url, opts);
}

describe('socket.io', () => {

  it('should be the same version as client', () => {
    let version = require('../package').version;
    expect(version).to.be(require('socket.io-client/package').version);
  });

  describe('set', () => {
    it('should be able to set ping timeout to engine.io', () => {
      let srv = new io(http());
      srv.set('heartbeat timeout', 10);
      expect(srv.eio.pingTimeout).to.be(10);
    });

    it('should be able to set ping interval to engine.io', () => {
      let srv = new io(http());
      srv.set('heartbeat interval', 10);
      expect(srv.eio.pingInterval).to.be(10);
    });

    it('should be able to set transports to engine.io', () => {
      let srv = new io(http());
      srv.set('transports', ['polling']);
      expect(srv.eio.transports).to.eql(['polling']);
    });

    it('should be able to set maxHttpBufferSize to engine.io', () => {
      let srv = new io(http());
      srv.set('destroy buffer size', 10);
      expect(srv.eio.maxHttpBufferSize).to.eql(10);
    });

    it('should be able to set path with setting resource', done => {
      let eio = new io();
      let srv = http();

      eio.set('resource', '/random');
      eio.attach(srv);

      // Check that the server is accessible through the specified path
      request(srv)
      .get('/random/socket.io.js')
      .buffer(true)
      .end((err, res) => {
        if (err) return done(err);
        done();
      });
    });

    it('should be able to set origins to engine.io', () => {
      let srv = new io(http());
      srv.set('origins', 'http://hostname.com:*');
      expect(srv.origins()).to.be('http://hostname.com:*');
    });

    it('should be able to set authorization and send error packet', done => {
      let httpSrv = http();
      let srv = new io(httpSrv);
      srv.set('authorization', (o, f) => { f(null, false); });

      let socket = client(httpSrv);
      socket.on('connect', () => {
        expect().fail();
      });
      socket.on('error', err => {
        expect(err).to.be('Not authorized');
        done();
      });
    });

    it('should be able to set authorization and succeed', done => {
      let httpSrv = http();
      let srv = new io(httpSrv);
      srv.set('authorization', (o, f) => { f(null, true); });

      srv.on('connection', s => {
        s.on('yoyo', data => {
          expect(data).to.be('data');
          done();
        });
      });

      let socket = client(httpSrv);
      socket.on('connect', () => {
        socket.emit('yoyo', 'data');
      });

      socket.on('error', err => {
        expect().fail();
      });
    });

    it('should set the handshake BC object', done => {
      let httpSrv = http();
      let srv = new io(httpSrv);

      srv.on('connection', s => {
        expect(s.handshake).to.not.be(undefined);

        // Headers set and has some valid properties
        expect(s.handshake.headers).to.be.an('object');
        expect(s.handshake.headers['user-agent']).to.be('node-XMLHttpRequest');

        // Time set and is valid looking string
        expect(s.handshake.time).to.be.a('string');
        expect(s.handshake.time.split(' ').length > 0); // Is "multipart" string representation

        // Address, xdomain, secure, issued and url set
        expect(s.handshake.address).to.contain('127.0.0.1');
        expect(s.handshake.xdomain).to.be.a('boolean');
        expect(s.handshake.secure).to.be.a('boolean');
        expect(s.handshake.issued).to.be.a('number');
        expect(s.handshake.url).to.be.a('string');

        // Query set and has some right properties
        expect(s.handshake.query).to.be.an('object');
        expect(s.handshake.query.EIO).to.not.be(undefined);
        expect(s.handshake.query.transport).to.not.be(undefined);
        expect(s.handshake.query.t).to.not.be(undefined);

        done();
      });

      let socket = client(httpSrv);
    });
  });

  describe('server attachment', () => {
    describe('http.Server', () => {
      let clientVersion = require('socket.io-client/package').version;

      it('should serve static files', done => {
        let srv = http();
        new io(srv);
        request(srv)
        .get('/socket.io/socket.io.js')
        .buffer(true)
        .end((err, res) => {
          if (err) return done(err);
          let ctype = res.headers['content-type'];
          expect(ctype).to.be('application/javascript');
          expect(res.headers.etag).to.be(clientVersion);
          expect(res.text).to.match(/engine\.io/);
          expect(res.status).to.be(200);
          done();
        });
      });

      it('should handle 304', done => {
        let srv = http();
        new io(srv);
        request(srv)
        .get('/socket.io/socket.io.js')
        .set('If-None-Match', clientVersion)
        .end((err, res) => {
          if (err) return done(err);
          expect(res.statusCode).to.be(304);
          done();
        });
      });

      it('should not serve static files', done => {
        let srv = http();
        new io(srv, { serveClient: false });
        request(srv)
        .get('/socket.io/socket.io.js')
        .expect(400, done);
      });

      it('should work with #attach', done => {
        let srv = http((req, res) => {
          res.writeHead(404);
          res.end();
        });
        let sockets = new io();
        sockets.attach(srv);
        request(srv)
        .get('/socket.io/socket.io.js')
        .end((err, res) => {
          if (err) return done(err);
          expect(res.status).to.be(200);
          done();
        });
      });
    });

    describe('port', done => {
      it('should be bound', done => {
        let sockets = new io(54010);
        request('http://localhost:54010')
        .get('/socket.io/socket.io.js')
        .expect(200, done);
      });

      it('should be bound as a string', done => {
        let sockets = new io('54020');
        request('http://localhost:54020')
        .get('/socket.io/socket.io.js')
        .expect(200, done);
      });

      it('with listen', done => {
        let sockets = new io().listen(54011);
        request('http://localhost:54011')
        .get('/socket.io/socket.io.js')
        .expect(200, done);
      });

      it('as a string', done => {
        let sockets = new io().listen('54012');
        request('http://localhost:54012')
        .get('/socket.io/socket.io.js')
        .expect(200, done);
      });
    });
  });

  describe('handshake', () => {
    let request = require('superagent');

    it('should disallow request when origin defined and none specified', done => {
      let sockets = new io({ origins: 'http://foo.example:*' }).listen('54013');
      request.get('http://localhost:54013/socket.io/default/')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(400);
          done();
        });
    });

    it('should disallow request when origin defined and a different one specified', done => {
      let sockets = new io({ origins: 'http://foo.example:*' }).listen('54014');
      request.get('http://localhost:54014/socket.io/default/')
       .query({ transport: 'polling' })
       .set('origin', 'http://herp.derp')
       .end((err, res) => {
          expect(res.status).to.be(400);
          done();
       });
    });

    it('should allow request when origin defined an the same is specified', done => {
      let sockets = new io({ origins: 'http://foo.example:*' }).listen('54015');
      request.get('http://localhost:54015/socket.io/default/')
       .set('origin', 'http://foo.example')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(200);
          done();
        });
    });

    it('should allow request when origin defined as function and same is supplied', done => {
      let sockets = new io({ origins: (origin, callback) => {
        if (origin == 'http://foo.example') {
          return callback(null, true);
        }
        return callback(null, false);
      } }).listen('54016');
      request.get('http://localhost:54016/socket.io/default/')
       .set('origin', 'http://foo.example')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(200);
          done();
        });
    });

    it('should allow request when origin defined as function and different is supplied', done => {
      let sockets = new io({ origins: (origin, callback) => {
        if (origin == 'http://foo.example') {
          return callback(null, true);
        }
        return callback(null, false);
      } }).listen('54017');
      request.get('http://localhost:54017/socket.io/default/')
       .set('origin', 'http://herp.derp')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(400);
          done();
        });
    });

    it('should allow request when origin defined as function and no origin is supplied', done => {
      let sockets = new io({ origins: (origin, callback) => {
        if (origin == '*') {
          return callback(null, true);
        }
        return callback(null, false);
      } }).listen('54021');
      request.get('http://localhost:54021/socket.io/default/')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(200);
          done();
        });
    });

    it('should default to port 443 when protocol is https', done => {
      let sockets = new io({ origins: 'https://foo.example:443' }).listen('54036');
      request.get('http://localhost:54036/socket.io/default/')
        .set('origin', 'https://foo.example')
        .query({ transport: 'polling' })
        .end((err, res) => {
          expect(res.status).to.be(200);
          done();
        });
    });

    it('should allow request if custom function in opts.allowRequest returns true', done => {
      let sockets = new io(http().listen(54022), { allowRequest: (req, callback) => {
        return callback(null, true);
      }, origins: 'http://foo.example:*' });

      request.get('http://localhost:54022/socket.io/default/')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(200);
          done();
        });
    });

    it('should disallow request if custom function in opts.allowRequest returns false', done => {
      let sockets = new io(http().listen(54023), { allowRequest: (req, callback) => {
        return callback(null, false);
      } });
      request.get('http://localhost:54023/socket.io/default/')
       .set('origin', 'http://foo.example')
       .query({ transport: 'polling' })
       .end((err, res) => {
          expect(res.status).to.be(400);
          done();
        });
    });
  });

  describe('close', () => {

    it('should be able to close sio sending a srv', () => {
      let PORT   = 54018;
      let srv    = http().listen(PORT);
      let sio    = new io(srv);
      let net    = require('net');
      let server = net.createServer();

      let clientSocket = client(srv, { reconnection: false });

      clientSocket.on('disconnect', () => {
        expect(Object.keys(sio.nsps['/'].sockets).length).to.equal(0);
        server.listen(PORT);
      });

      clientSocket.on('connect', () => {
        expect(Object.keys(sio.nsps['/'].sockets).length).to.equal(1);
        sio.close();
      });

      server.once('listening', () => {
        // PORT should be free
        server.close(error => {
          expect(error).to.be(undefined);
        });
      });

    });

    it('should be able to close sio sending a port', () => {
      let PORT   = 54019;
      let sio    = new io(PORT);
      let net    = require('net');
      let server = net.createServer();

      let clientSocket = ioc('ws://0.0.0.0:' + PORT);

      clientSocket.on('disconnect', () => {
        expect(Object.keys(sio.nsps['/'].sockets).length).to.equal(0);
        server.listen(PORT);
      });

      clientSocket.on('connect', () => {
        expect(Object.keys(sio.nsps['/'].sockets).length).to.equal(1);
        sio.close();
      });

      server.once('listening', () => {
        // PORT should be free
        server.close(error => {
          expect(error).to.be(undefined);
        });
      });
    });

  });

  describe('namespaces', () => {
    let Socket = require('../lib/socket');
    let Namespace = require('../lib/namespace');

    it('should be accessible through .sockets', () => {
      let sio = new io();
      expect(sio.sockets).to.be.a(Namespace);
    });

    it('should be aliased', () => {
      let sio = new io();
      expect(sio.use).to.be.a('function');
      expect(sio.to).to.be.a('function');
      expect(sio['in']).to.be.a('function');
      expect(sio.emit).to.be.a('function');
      expect(sio.send).to.be.a('function');
      expect(sio.write).to.be.a('function');
      expect(sio.clients).to.be.a('function');
      expect(sio.compress).to.be.a('function');
      expect(sio.json).to.be(sio);
      expect(sio.volatile).to.be(sio);
      expect(sio.sockets.flags).to.eql({ json: true, volatile: true });
      delete sio.sockets.flags;
    });

    it('should automatically connect', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        socket.on('connect', () => {
          done();
        });
      });
    });

    it('should fire a `connection` event', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', socket => {
          expect(socket).to.be.a(Socket);
          done();
        });
      });
    });

    it('should fire a `connect` event', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connect', socket => {
          expect(socket).to.be.a(Socket);
          done();
        });
      });
    });

    it('should work with many sockets', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        sio.of('/chat');
        sio.of('/news');
        let chat = client(srv, '/chat');
        let news = client(srv, '/news');
        let total = 2;
        chat.on('connect', () => {
          --total || done();
        });
        news.on('connect', () => {
          --total || done();
        });
      });
    });

    it('should be able to equivalently start with "" or "/" on server', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;
      sio.of('').on('connection', () => {
        --total || done();
      });
      sio.of('abc').on('connection', () => {
        --total || done();
      });
      let c1 = client(srv, '/');
      let c2 = client(srv, '/abc');
    });

    it('should be equivalent for "" and "/" on client', done => {
      let srv = http();
      let sio = new io(srv);
      sio.of('/').on('connection', () => {
          done();
      });
      let c1 = client(srv, '');
    });

    it('should work with `of` and many sockets', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let chat = client(srv, '/chat');
        let news = client(srv, '/news');
        let total = 2;
        sio.of('/news').on('connection', socket => {
          expect(socket).to.be.a(Socket);
          --total || done();
        });
        sio.of('/news').on('connection', socket => {
          expect(socket).to.be.a(Socket);
          --total || done();
        });
      });
    });

    it('should work with `of` second param', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let chat = client(srv, '/chat');
        let news = client(srv, '/news');
        let total = 2;
        sio.of('/news', socket => {
          expect(socket).to.be.a(Socket);
          --total || done();
        });
        sio.of('/news', socket => {
          expect(socket).to.be.a(Socket);
          --total || done();
        });
      });
    });

    it('should disconnect upon transport disconnection', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let chat = client(srv, '/chat');
        let news = client(srv, '/news');
        let total = 2;
        let totald = 2;
        let s;
        let close = () => {
          s.disconnect(true);
        };
        sio.of('/news', socket => {
          socket.on('disconnect', reason => {
            --totald || done();
          });
          --total || close();
        });
        sio.of('/chat', socket => {
          s = socket;
          socket.on('disconnect', reason => {
            --totald || done();
          });
          --total || close();
        });
      });
    });

    it('should disconnect both default and custom namespace upon disconnect', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let lolcats = client(srv, '/lolcats');
        let total = 2;
        let totald = 2;
        let s;
        let close = () => {
          s.disconnect(true);
        };
        sio.of('/', socket => {
          socket.on('disconnect', reason => {
            --totald || done();
          });
          --total || close();
        });
        sio.of('/lolcats', socket => {
          s = socket;
          socket.on('disconnect', reason => {
            --totald || done();
          });
          --total || close();
        });
      });
    });

    it('should not crash while disconnecting socket', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv,'/ns');
        sio.on('connection', socket => {
          socket.disconnect();
          done();
        });
      });
    });

    it('should return error connecting to non-existent namespace', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv,'/doesnotexist');
        socket.on('error', err => {
          expect(err).to.be('Invalid namespace');
          done();
        });
      });
    });

    it('should not reuse same-namespace connections', done => {
      let srv = http();
      let sio = new io(srv);
      let connections = 0;

      srv.listen(() => {
        let clientSocket1 = client(srv);
        let clientSocket2 = client(srv);
        sio.on('connection', () => {
          connections++;
          if(connections === 2) {
            done();
          }
        });
      });
    });

    it('should find all clients in a namespace', done => {
      let srv = http();
      let sio = new io(srv);
      let chatSids = [];
      let otherSid = null;
      let getClients = () => {
        sio.of('/chat').clients((error, sids) => {
          expect(error).to.not.be.ok();
          expect(sids).to.contain(chatSids[0]);
          expect(sids).to.contain(chatSids[1]);
          expect(sids).to.not.contain(otherSid);
          done();
        });
      };
      srv.listen(() => {
        let c1 = client(srv, '/chat');
        let c2 = client(srv, '/chat', {forceNew: true});
        let c3 = client(srv, '/other', {forceNew: true});
        let total = 3;
        sio.of('/chat').on('connection', socket => {
          chatSids.push(socket.id);
          --total || getClients();
        });
        sio.of('/other').on('connection', socket => {
          otherSid = socket.id;
          --total || getClients();
        });
      });
    });

    it('should find all clients in a namespace room', done => {
      let srv = http();
      let sio = new io(srv);
      let chatFooSid = null;
      let chatBarSid = null;
      let otherSid = null;
      let getClients = () => {
        sio.of('/chat').in('foo').clients((error, sids) => {
          expect(error).to.not.be.ok();
          expect(sids).to.contain(chatFooSid);
          expect(sids).to.not.contain(chatBarSid);
          expect(sids).to.not.contain(otherSid);
          done();
        });
      };
      srv.listen(() => {
        let c1 = client(srv, '/chat');
        let c2 = client(srv, '/chat', {forceNew: true});
        let c3 = client(srv, '/other', {forceNew: true});
        let chatIndex = 0;
        let total = 3;
        sio.of('/chat').on('connection', socket => {
          if (chatIndex++) {
            socket.join('foo', () => {
              chatFooSid = socket.id;
              --total || getClients();
            });
          } else {
            socket.join('bar', () => {
              chatBarSid = socket.id;
              --total || getClients();
            });
          }
        });
        sio.of('/other').on('connection', socket => {
          socket.join('foo', () => {
            otherSid = socket.id;
            --total || getClients();
          });
        });
      });
    });

    it('should find all clients across namespace rooms', done => {
      let srv = http();
      let sio = new io(srv);
      let chatFooSid = null;
      let chatBarSid = null;
      let otherSid = null;
      let getClients = () => {
        sio.of('/chat').clients((error, sids) => {
          expect(error).to.not.be.ok();
          expect(sids).to.contain(chatFooSid);
          expect(sids).to.contain(chatBarSid);
          expect(sids).to.not.contain(otherSid);
          done();
        });
      };
      srv.listen(() => {
        let c1 = client(srv, '/chat');
        let c2 = client(srv, '/chat', {forceNew: true});
        let c3 = client(srv, '/other', {forceNew: true});
        let chatIndex = 0;
        let total = 3;
        sio.of('/chat').on('connection', socket => {
          if (chatIndex++) {
            socket.join('foo', () => {
              chatFooSid = socket.id;
              --total || getClients();
            });
          } else {
            socket.join('bar', () => {
              chatBarSid = socket.id;
              --total || getClients();
            });
          }
        });
        sio.of('/other').on('connection', socket => {
          socket.join('foo', () => {
            otherSid = socket.id;
            --total || getClients();
          });
        });
      });
    });

    it('should not emit volatile event after regular event', done => {
      let srv = http();
      let sio = new io(srv);

      let counter = 0;
      srv.listen(() => {
        sio.of('/chat').on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            sio.of('/chat').emit('ev', 'data');
            sio.of('/chat').volatile.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, '/chat');
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should emit volatile event', done => {
      let srv = http();
      let sio = new io(srv);

      let counter = 0;
      srv.listen(() => {
        sio.of('/chat').on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            sio.of('/chat').volatile.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, '/chat');
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should enable compression by default', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv, '/chat');
        sio.of('/chat').on('connection', s => {
          s.conn.once('packetCreate', packet => {
            expect(packet.options.compress).to.be(true);
            done();
          });
          sio.of('/chat').emit('woot', 'hi');
        });
      });
    });

    it('should disable compression', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv, '/chat');
        sio.of('/chat').on('connection', s => {
          s.conn.once('packetCreate', packet => {
            expect(packet.options.compress).to.be(false);
            done();
          });
          sio.of('/chat').compress(false).emit('woot', 'hi');
        });
      });
    });
  });

  describe('socket', () => {

    it('should not fire events more than once after manually reconnecting', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let clientSocket = client(srv, { reconnection: false });
        clientSocket.on('connect', function init() {
          clientSocket.removeListener('connect', init);
          clientSocket.io.engine.close();

          clientSocket.connect();
          clientSocket.on('connect', () => {
            done();
          });
        });
      });
    });

    it('should not fire reconnect_failed event more than once when server closed', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let clientSocket = client(srv, { reconnectionAttempts: 3, reconnectionDelay: 10 });
        clientSocket.on('connect', () => {
          srv.close();
        });

        clientSocket.on('reconnect_failed', () => {
          done();
        });
      });
    });

    it('should receive events', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('random', (a, b, c) => {
            expect(a).to.be(1);
            expect(b).to.be('2');
            expect(c).to.eql([3]);
            done();
          });
          socket.emit('random', 1, '2', [3]);
        });
      });
    });

    it('should receive message events through `send`', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('message', a => {
            expect(a).to.be(1337);
            done();
          });
          socket.send(1337);
        });
      });
    });

    it('should error with null messages', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('message', a => {
            expect(a).to.be(null);
            done();
          });
          socket.send(null);
        });
      });
    });

    it('should handle transport null messages', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('error', err => {
            expect(err).to.be.an(Error);
            s.on('disconnect', reason => {
              expect(reason).to.be('client error');
              done();
            });
          });
          s.client.ondata(null);
        });
      });
    });

    it('should emit events', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        socket.on('woot', a => {
          expect(a).to.be('tobi');
          done();
        });
        sio.on('connection', s => {
          s.emit('woot', 'tobi');
        });
      });
    });

    it('should emit events with utf8 multibyte character', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        let i = 0;
        socket.on('hoot', a => {
          expect(a).to.be('utf8 — string');
          i++;

          if (3 == i) {
            done();
          }
        });
        sio.on('connection', s => {
          s.emit('hoot', 'utf8 — string');
          s.emit('hoot', 'utf8 — string');
          s.emit('hoot', 'utf8 — string');
        });
      });
    });

    it('should emit events with binary data', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        let imageData;
        socket.on('doge', a => {
          expect(Buffer.isBuffer(a)).to.be(true);
          expect(imageData.length).to.equal(a.length);
          expect(imageData[0]).to.equal(a[0]);
          expect(imageData[imageData.length - 1]).to.equal(a[a.length - 1]);
          done();
        });
        sio.on('connection', s => {
          fs.readFile(join(__dirname, 'support', 'doge.jpg'), (err, data) => {
            if (err) return done(err);
            imageData = data;
            s.emit('doge', data);
          });
        });
      });
    });

    it('should emit events with several types of data (including binary)', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        socket.on('multiple', (a, b, c, d, e, f) => {
          expect(a).to.be(1);
          expect(Buffer.isBuffer(b)).to.be(true);
          expect(c).to.be('3');
          expect(d).to.eql([4]);
          expect(Buffer.isBuffer(e)).to.be(true);
          expect(Buffer.isBuffer(f[0])).to.be(true);
          expect(f[1]).to.be('swag');
          expect(Buffer.isBuffer(f[2])).to.be(true);
          done();
        });
        sio.on('connection', s => {
          fs.readFile(join(__dirname, 'support', 'doge.jpg'), (err, data) => {
            if (err) return done(err);
            let buf = new Buffer('asdfasdf', 'utf8');
            s.emit('multiple', 1, data, '3', [4], buf, [data, 'swag', buf]);
          });
        });
      });
    });

    it('should receive events with binary data', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('buff', a => {
            expect(Buffer.isBuffer(a)).to.be(true);
            done();
          });
          let buf = new Buffer('abcdefg', 'utf8');
          socket.emit('buff', buf);
        });
      });
    });

    it('should receive events with several types of data (including binary)', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('multiple', (a, b, c, d, e, f) => {
          expect(a).to.be(1);
          expect(Buffer.isBuffer(b)).to.be(true);
          expect(c).to.be('3');
          expect(d).to.eql([4]);
          expect(Buffer.isBuffer(e)).to.be(true);
          expect(Buffer.isBuffer(f[0])).to.be(true);
          expect(f[1]).to.be('swag');
          expect(Buffer.isBuffer(f[2])).to.be(true);
          done();
          });
          fs.readFile(join(__dirname, 'support', 'doge.jpg'), (err, data) => {
            if (err) return done(err);
            let buf = new Buffer('asdfasdf', 'utf8');
            socket.emit('multiple', 1, data, '3', [4], buf, [data, 'swag', buf]);
          });
        });
      });
    });

    it('should not emit volatile event after regular event (polling)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['polling'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          s.emit('ev', 'data');
          s.volatile.emit('ev', 'data');
        });

        let socket = client(srv, { transports: ['polling'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should not emit volatile event after regular event (ws)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['websocket'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          s.emit('ev', 'data');
          s.volatile.emit('ev', 'data');
        });

        let socket = client(srv, { transports: ['websocket'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should emit volatile event (polling)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['polling'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            s.volatile.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, { transports: ['polling'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should emit volatile event (ws)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['websocket'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            s.volatile.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, { transports: ['websocket'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should emit only one consecutive volatile event (polling)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['polling'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            s.volatile.emit('ev', 'data');
            s.volatile.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, { transports: ['polling'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should emit only one consecutive volatile event (ws)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['websocket'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            s.volatile.emit('ev', 'data');
            s.volatile.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, { transports: ['websocket'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(1);
        done();
      }, 200);
    });

    it('should emit regular events after trying a failed volatile event (polling)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['polling'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            s.emit('ev', 'data');
            s.volatile.emit('ev', 'data');
            s.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, { transports: ['polling'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(2);
        done();
      }, 200);
    });

    it('should emit regular events after trying a failed volatile event (ws)', done => {
      let srv = http();
      let sio = new io(srv, { transports: ['websocket'] });

      let counter = 0;
      srv.listen(() => {
        sio.on('connection', s => {
          // Wait to make sure there are no packets being sent for opening the connection
          setTimeout(() => {
            s.emit('ev', 'data');
            s.volatile.emit('ev', 'data');
            s.emit('ev', 'data');
          }, 20);
        });

        let socket = client(srv, { transports: ['websocket'] });
        socket.on('ev', () => {
          counter++;
        });
      });

      setTimeout(() => {
        expect(counter).to.be(2);
        done();
      }, 200);
    });

    it('should emit message events through `send`', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        socket.on('message', a => {
          expect(a).to.be('a');
          done();
        });
        sio.on('connection', s => {
          s.send('a');
        });
      });
    });

    it('should receive event with callbacks', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('woot', fn => {
            fn(1, 2);
          });
          socket.emit('woot', (a, b) => {
            expect(a).to.be(1);
            expect(b).to.be(2);
            done();
          });
        });
      });
    });

    it('should receive all events emitted from namespaced client immediately and in order', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 0;
      srv.listen(() => {
        sio.of('/chat', s => {
          s.on('hi', letter => {
            total++;
            if (total == 2 && letter == 'b') {
              done();
            } else if (total == 1 && letter != 'a') {
              throw new Error('events out of order');
            }
          });
        });

        let chat = client(srv, '/chat');
        chat.emit('hi', 'a');
        setTimeout(() => {
          chat.emit('hi', 'b');
        }, 50);
      });
    });

    it('should emit events with callbacks', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          socket.on('hi', fn => {
            fn();
          });
          s.emit('hi', () => {
            done();
          });
        });
      });
    });

    it('should receive events with args and callback', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('woot', (a, b, fn) => {
            expect(a).to.be(1);
            expect(b).to.be(2);
            fn();
          });
          socket.emit('woot', 1, 2, () => {
            done();
          });
        });
      });
    });

    it('should emit events with args and callback', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          socket.on('hi', (a, b, fn) => {
            expect(a).to.be(1);
            expect(b).to.be(2);
            fn();
          });
          s.emit('hi', 1, 2, () => {
            done();
          });
        });
      });
    });

    it('should receive events with binary args and callbacks', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('woot', (buf, fn) => {
            expect(Buffer.isBuffer(buf)).to.be(true);
            fn(1, 2);
          });
          socket.emit('woot', new Buffer(3), (a, b) => {
            expect(a).to.be(1);
            expect(b).to.be(2);
            done();
          });
        });
      });
    });

    it('should emit events with binary args and callback', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          socket.on('hi', (a, fn) => {
            expect(Buffer.isBuffer(a)).to.be(true);
            fn();
          });
          s.emit('hi', new Buffer(4), () => {
            done();
          });
        });
      });
    });

    it('should emit events and receive binary data in a callback', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          socket.on('hi', fn => {
            fn(new Buffer(1));
          });
          s.emit('hi', a => {
            expect(Buffer.isBuffer(a)).to.be(true);
            done();
          });
        });
      });
    });

    it('should receive events and pass binary data in a callback', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.on('woot', fn => {
            fn(new Buffer(2));
          });
          socket.emit('woot', a => {
            expect(Buffer.isBuffer(a)).to.be(true);
            done();
          });
        });
      });
    });

    it('should have access to the client', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          expect(s.client).to.be.an('object');
          done();
        });
      });
    });

    it('should have access to the connection', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          expect(s.client.conn).to.be.an('object');
          expect(s.conn).to.be.an('object');
          done();
        });
      });
    });

    it('should have access to the request', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          expect(s.client.request.headers).to.be.an('object');
          expect(s.request.headers).to.be.an('object');
          done();
        });
      });
    });

    it('should see query parameters in the request', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let addr = srv.listen().address();
        let url = 'ws://localhost:' + addr.port + '?key1=1&key2=2';
        let socket = ioc(url);
        sio.on('connection', s => {
          let parsed = require('url').parse(s.request.url);
          let query = require('querystring').parse(parsed.query);
          expect(query.key1).to.be('1');
          expect(query.key2).to.be('2');
          done();
        });
      });
    });

    it('should handle very large json', function (done){
      this.timeout(30000);
      let srv = http();
      let sio = new io(srv, { perMessageDeflate: false });
      let received = 0;
      srv.listen(() => {
        let socket = client(srv);
        socket.on('big', a => {
          expect(Buffer.isBuffer(a.json)).to.be(false);
          if (++received == 3)
            done();
          else
            socket.emit('big', a);
        });
        sio.on('connection', s => {
          fs.readFile(join(__dirname, 'fixtures', 'big.json'), (err, data) => {
            if (err) return done(err);
            data = JSON.parse(data);
            s.emit('big', {hello: 'friend', json: data});
          });
          s.on('big', a => {
            s.emit('big', a);
          });
        });
      });
    });

    it('should handle very large binary data', function(done){
      this.timeout(30000);
      let srv = http();
      let sio = new io(srv, { perMessageDeflate: false });
      let received = 0;
      srv.listen(() => {
        let socket = client(srv);
        socket.on('big', a => {
          expect(Buffer.isBuffer(a.image)).to.be(true);
          if (++received == 3)
            done();
          else
            socket.emit('big', a);
        });
        sio.on('connection', s => {
          fs.readFile(join(__dirname, 'fixtures', 'big.jpg'), (err, data) => {
            if (err) return done(err);
            s.emit('big', {hello: 'friend', image: data});
          });
          s.on('big', a => {
            expect(Buffer.isBuffer(a.image)).to.be(true);
            s.emit('big', a);
          });
        });
      });
    });

    it('should be able to emit after server close and restart', done => {
      let srv = http();
      let sio = new io(srv);

      sio.on('connection', socket => {
        socket.on('ev', data => {
          expect(data).to.be('payload');
          done();
        });
      });

      srv.listen(() => {
        let port = srv.address().port;
        let clientSocket = client(srv, { reconnectionAttempts: 10, reconnectionDelay: 100 });
        clientSocket.once('connect', () => {
          srv.close(() => {
            srv.listen(port, () => {
              clientSocket.on('reconnect', () => {
                clientSocket.emit('ev', 'payload');
              });
            });
          });
        });
      });
    });

    it('should enable compression by default', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv, '/chat');
        sio.of('/chat').on('connection', s => {
          s.conn.once('packetCreate', packet => {
            expect(packet.options.compress).to.be(true);
            done();
          });
          sio.of('/chat').emit('woot', 'hi');
        });
      });
    });

    it('should disable compression', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv, '/chat');
        sio.of('/chat').on('connection', s => {
          s.conn.once('packetCreate', packet => {
            expect(packet.options.compress).to.be(false);
            done();
          });
          sio.of('/chat').compress(false).emit('woot', 'hi');
        });
      });
    });

    it('should error with raw binary and warn', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.conn.on('upgrade', () => {
            console.log('\u001b[96mNote: warning expected and normal in test.\u001b[39m');
            socket.io.engine.write('5woooot');
            setTimeout(() => {
              done();
            }, 100);
          });
        });
      });
    });

    it('should not crash with raw binary', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.once('error', err => {
            expect(err.message).to.match(/Illegal attachments/);
            done();
          });
          s.conn.on('upgrade', () => {
            socket.io.engine.write('5woooot');
          });
        });
      });
    });

    it('should handle empty binary packet', done => {
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.once('error', err => {
            expect(err.message).to.match(/Illegal attachments/);
            done();
          });
          s.conn.on('upgrade', () => {
            socket.io.engine.write('5');
          });
        });
      });
    });

    it('should not crash when messing with Object prototype', done => {
      Object.prototype.foo = 'bar';
      let srv = http();
      let sio = new io(srv);
      srv.listen(() => {
        let socket = client(srv);

        sio.on('connection', s => {
          s.disconnect(true);
          sio.close();
          setTimeout(() => {
            done();
          }, 100);
        });
      });
    });

    it('should always trigger the callback (if provided) when joining a room', done => {
      let srv = http();
      let sio = new io(srv);

      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.join('a', () => {
            s.join('a', done);
          });
        });
      });
    });

  });

  describe('messaging many', () => {
    it('emits to a namespace', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });
        let socket3 = client(srv, '/test');
        let emit = () => {
          sio.emit('a', 'b');
        };
        socket1.on('a', a => {
          expect(a).to.be('b');
          --total || done();
        });
        socket2.on('a', a => {
          expect(a).to.be('b');
          --total || done();
        });
        socket3.on('a', () => { done(new Error('not')); });

        let sockets = 3;
        sio.on('connection', socket => {
          --sockets || emit();
        });
        sio.of('/test', socket => {
          --sockets || emit();
        });
      });
    });

    it('emits binary data to a namespace', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });
        let socket3 = client(srv, '/test');
        let emit = () => {
          sio.emit('bin', new Buffer(10));
        };
        socket1.on('bin', a => {
          expect(Buffer.isBuffer(a)).to.be(true);
          --total || done();
        });
        socket2.on('bin', a => {
          expect(Buffer.isBuffer(a)).to.be(true);
          --total || done();
        });
        socket3.on('bin', () => { done(new Error('not')); });

        let sockets = 3;
        sio.on('connection', socket => {
          --sockets || emit();
        });
        sio.of('/test', socket => {
          --sockets || emit();
        });
      });
    });

    it('emits to the rest', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });
        let socket3 = client(srv, '/test');
        socket1.on('a', a => {
          expect(a).to.be('b');
          socket1.emit('finish');
        });
        socket2.emit('broadcast');
        socket2.on('a', () => { done(new Error('done')); });
        socket3.on('a', () => { done(new Error('not')); });

        let sockets = 2;
        sio.on('connection', socket => {
          socket.on('broadcast', () => {
            socket.broadcast.emit('a', 'b');
          });
          socket.on('finish', () => {
            done();
          });
        });
      });
    });

    it('emits to rooms', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });

        socket2.on('a', () => {
          done(new Error('not'));
        });
        socket1.on('a', () => {
          done();
        });
        socket1.emit('join', 'woot', () => {
          socket1.emit('emit', 'woot');
        });

        sio.on('connection', socket => {
          socket.on('join', (room, fn) => {
            socket.join(room, fn);
          });

          socket.on('emit', room => {
            sio.in(room).emit('a');
          });
        });
      });
    });

    it('emits to rooms avoiding dupes', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });

        socket2.on('a', () => {
          done(new Error('not'));
        });
        socket1.on('a', () => {
          --total || done();
        });
        socket2.on('b', () => {
          --total || done();
        });

        socket1.emit('join', 'woot');
        socket1.emit('join', 'test');
        socket2.emit('join', 'third', () => {
          socket2.emit('emit');
        });

        sio.on('connection', socket => {
          socket.on('join', (room, fn) => {
            socket.join(room, fn);
          });

          socket.on('emit', room => {
            sio.in('woot').in('test').emit('a');
            sio.in('third').emit('b');
          });
        });
      });
    });

    it('broadcasts to rooms', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });
        let socket3 = client(srv, { multiplex: false });

        socket1.emit('join', 'woot');
        socket2.emit('join', 'test');
        socket3.emit('join', 'test', () => {
          socket3.emit('broadcast');
        });

        socket1.on('a', () => {
          done(new Error('not'));
        });
        socket2.on('a', () => {
          --total || done();
        });
        socket3.on('a', () => {
          done(new Error('not'));
        });
        socket3.on('b', () => {
          --total || done();
        });

        sio.on('connection', socket => {
          socket.on('join', (room, fn) => {
            socket.join(room, fn);
          });

          socket.on('broadcast', () => {
            socket.broadcast.to('test').emit('a');
            socket.emit('b');
          });
        });
      });
    });

    it('broadcasts binary data to rooms', done => {
      let srv = http();
      let sio = new io(srv);
      let total = 2;

      srv.listen(() => {
        let socket1 = client(srv, { multiplex: false });
        let socket2 = client(srv, { multiplex: false });
        let socket3 = client(srv, { multiplex: false });

        socket1.emit('join', 'woot');
        socket2.emit('join', 'test');
        socket3.emit('join', 'test', () => {
          socket3.emit('broadcast');
        });

        socket1.on('bin', data => {
          throw new Error('got bin in socket1');
        });
        socket2.on('bin', data => {
          expect(Buffer.isBuffer(data)).to.be(true);
          --total || done();
        });
        socket2.on('bin2', data => {
          throw new Error('socket2 got bin2');
        });
        socket3.on('bin', data => {
          throw new Error('socket3 got bin');
        });
        socket3.on('bin2', data => {
          expect(Buffer.isBuffer(data)).to.be(true);
          --total || done();
        });

        sio.on('connection', socket => {
          socket.on('join', (room, fn) => {
            socket.join(room, fn);
          });
          socket.on('broadcast', () => {
            socket.broadcast.to('test').emit('bin', new Buffer(5));
            socket.emit('bin2', new Buffer(5));
          });
        });
      });
    });


    it('keeps track of rooms', done => {
      let srv = http();
      let sio = new io(srv);

      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.join('a', () => {
            expect(Object.keys(s.rooms)).to.eql([s.id, 'a']);
            s.join('b', () => {
              expect(Object.keys(s.rooms)).to.eql([s.id, 'a', 'b']);
              s.join( 'c', () => {
                expect(Object.keys(s.rooms)).to.eql([s.id, 'a', 'b', 'c']);
                s.leave('b', () => {
                  expect(Object.keys(s.rooms)).to.eql([s.id, 'a', 'c']);
                  s.leaveAll();
                  expect(Object.keys(s.rooms)).to.eql([]);
                  done();
                });
              });
            });
          });
        });
      });
    });

    it('deletes empty rooms', done => {
      let srv = http();
      let sio = new io(srv);

      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.join('a', () => {
            expect(s.nsp.adapter.rooms).to.have.key('a');
            s.leave('a', () => {
              expect(s.nsp.adapter.rooms).to.not.have.key('a');
              done();
            });
          });
        });
      });
    });

    it('should properly cleanup left rooms', done => {
      let srv = http();
      let sio = new io(srv);

      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', s => {
          s.join('a', () => {
            expect(Object.keys(s.rooms)).to.eql([s.id, 'a']);
            s.join('b', () => {
              expect(Object.keys(s.rooms)).to.eql([s.id, 'a', 'b']);
              s.leave('unknown', () => {
                expect(Object.keys(s.rooms)).to.eql([s.id, 'a', 'b']);
                s.leaveAll();
                expect(Object.keys(s.rooms)).to.eql([]);
                done();
              });
            });
          });
        });
      });
    });
  });

  describe('middleware', done => {
    let Socket = require('../lib/socket');

    it('should call functions', done => {
      let srv = http();
      let sio = new io(srv);
      let run = 0;
      sio.use((socket, next) => {
        expect(socket).to.be.a(Socket);
        run++;
        next();
      });
      sio.use((socket, next) => {
        expect(socket).to.be.a(Socket);
        run++;
        next();
      });
      srv.listen(() => {
        let socket = client(srv);
        socket.on('connect', () => {
          expect(run).to.be(2);
          done();
        });
      });
    });

    it('should pass errors', done => {
      let srv = http();
      let sio = new io(srv);
      let run = 0;
      sio.use((socket, next) => {
        next(new Error('Authentication error'));
      });
      sio.use((socket, next) => {
        done(new Error('nope'));
      });
      srv.listen(() => {
        let socket = client(srv);
        socket.on('connect', () => {
          done(new Error('nope'));
        });
        socket.on('error', err => {
          expect(err).to.be('Authentication error');
          done();
        });
      });
    });

    it('should pass `data` of error object', done => {
      let srv = http();
      let sio = new io(srv);
      let run = 0;
      sio.use((socket, next) => {
        let err = new Error('Authentication error');
        err.data = { a: 'b', c: 3 };
        next(err);
      });
      srv.listen(() => {
        let socket = client(srv);
        socket.on('connect', () => {
          done(new Error('nope'));
        });
        socket.on('error', err => {
          expect(err).to.eql({ a: 'b', c: 3 });
          done();
        });
      });
    });

    it('should only call connection after fns', done => {
      let srv = http();
      let sio = new io(srv);
      sio.use((socket, next) => {
        socket.name = 'guillermo';
        next();
      });
      srv.listen(() => {
        let socket = client(srv);
        sio.on('connection', socket => {
          expect(socket.name).to.be('guillermo');
          done();
        });
      });
    });

    it('should be ignored if socket gets closed', done => {
      let srv = http();
      let sio = new io(srv);
      let socket;
      sio.use((s, next) => {
        socket.io.engine.on('open', () => {
          socket.io.engine.close();
          s.client.conn.on('close', () => {
            process.nextTick(next);
            setTimeout(() => {
              done();
            }, 50);
          });
        });
      });
      srv.listen(() => {
        socket = client(srv);
        sio.on('connection', socket => {
          done(new Error('should not fire'));
        });
      });
    });

    it('should call functions in expected order', done => {
      let srv = http();
      let sio = new io(srv);
      let result = [];

      sio.use((socket, next) => {
        result.push(1);
        setTimeout(next, 50);
      });
      sio.use((socket, next) => {
        result.push(2);
        setTimeout(next, 50);
      });
      sio.of('/chat').use((socket, next) => {
        result.push(3);
        setTimeout(next, 50);
      });
      sio.of('/chat').use((socket, next) => {
        result.push(4);
        setTimeout(next, 50);
      });

      srv.listen(() => {
        let chat = client(srv, '/chat');
        chat.on('connect', () => {
          expect(result).to.eql([1, 2, 3, 4]);
          done();
        });
      });
    });
  });
});

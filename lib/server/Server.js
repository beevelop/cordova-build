/**
 * @name Server
 * @version 0.1
 * @fileoverview @todo
 */

var Build = require('../common/Build');
var Msg = require('../common/Msg');
var ServerSockets = require('./ServerSockets');
var Cache = require('./Cache');
var UIServer = require('./UIServer');
var path = require('path');
var fs = require('fs-extra');
var multiGlob = require('multi-glob');
var async = require('async');
var io = require('socket.io');
var http = require('http');

/**
 * Constructor of server
 * @class
 * @param {Object} conf - configuration (console options)
 */
function Server(conf) {
    this.conf = conf || {};
    this.agents = [];
    this.buildsQueue = [];
    this.clients = [];
    this.logs = [];
    this.wwws = [];
    this.platforms = {};
    this.builds = [];
    this.location = conf.location || path.resolve('builds');
    this.www = path.resolve(__dirname, '../../www');

    this.cache = this.initCache();
}

/**
 * the GUI's HTML files
 * @type {string[]}
 */
Server.prototype.htmlFiles = ['index.html', 'server.html'];

/**
 * Instantiate new {@link Cache} object, add html files and reload on updates
 * @return {Cache} cache object
 */
Server.prototype.initCache = function () {
    var _self = this;
    var cache = new Cache(this.www);

    cache.on('updated', function () {
        if (_self.wwws && _self.wwws.socket) {
            _self.wwws.socket.emit.defer(500, _self.wwws.socket, 'reload');
        }
    });

    this.htmlFiles.forEach(function (file) {
        cache.addFile(path.resolve(_self.www, file), file);
    });

    return cache;
};

/**
 * Reads + parses the found builds and stores the generated {@link Build} objects
 * @param {Object}  [err]   - error object (globbing failed) or null
 * @param {Object}   builds - array of found build.json files
 */
Server.prototype.readPreviousBuilds = function (err, builds) {
    var _self = this;

    builds.sort();
    var loadedBuilds = [];
    var orderedBuilds = {};
    async.each(builds, function (buildPath, cb) {
        /* Instantiate Build object from JSON */
        fs.readFile(buildPath, function (err, data) {
            var buildJSON;
            try {
                buildJSON = JSON.parse(data);
            } catch (e) {
                return cb(e);
            }
            var build = new Build(buildJSON);
            loadedBuilds.push(build);
            orderedBuilds[buildPath] = build;
            cb();
        });
    }, function (err) {
        builds.forEach(function (buildPath) {
            var build = orderedBuilds[buildPath];
            if (build) {
                _self.builds.push(build);
                _self.builds[build.id] = build;
                if (build.platforms) {
                    build.platforms.forEach(function (platformBuild) {
                        _self.builds[platformBuild.id] = platformBuild;
                    });
                }
            }
        });

        var _msg;
        if (loadedBuilds.length) {
            _msg = '{2} previous build(s) were successfully read from the disk';
            _self.log(new Msg(null, null, 'S', Msg.debug, _msg, loadedBuilds.length));
        }
        if (err) {
            _msg = 'an error occurred while trying to read previous build(s) from the disk\n{2}';
            _self.log(new Msg(null, null, 'S', Msg.debug, _msg, err));
        }
    });
};

Server.prototype.listen = function () {
    var conf = this.conf;
    var uiOnly = conf.mode === 'ui';
    conf.uiport = conf.uiport === 0 || conf.uiport === false ? false : conf.uiport || 8300;

    if (conf.uiport) {
        /* Start UIServer if uiport isn't 0 */
        var uiserver = new UIServer(conf, this.cache, this.www);

        var interfacePort = conf.proxyport || conf.uiport || conf.port;
        console.log('Cordova build INTERFACE is accessible at {0}{1}{2}/'.format(
            conf.proxyprotocol || conf.uiprotocol || conf.protocol || 'http://',
            conf.proxy || conf.ui || conf.server || 'localhost',
            interfacePort === 80 ? '' : ':' + interfacePort)
        );
    } else {
        console.log('Cordova build INTERFACE is disabled because you have specified -uiport:0');
    }

    console.log('Cordova build SERVER is {0} at {1}{2}{3}/\n'.format(
        uiOnly ? 'targeted' : 'hosted',
        conf.protocol, conf.server,
        conf.port === 80 ? '' : ':' + conf.port)
    );

    if (uiOnly) {
        /* No need for a socket */
        this.socket = null;
    } else {

        // @todo: move to 'initSockets' function

        if (conf.uiport !== conf.port) {
            var buildserver = new BuildServer(conf, this.cache, this.www);
            this.socket = buildserver.getSocket();
        } else {
            this.socket = uiserver.getSocket();
        }

        this.socket.set('transports', ['websocket', 'polling']); // enable all transports

        this.agents.socket = ServerSockets.agentsSocket.call(this);
        this.clients.socket = ServerSockets.clientsSocket.call(this);
        this.wwws.socket = ServerSockets.wwwsSocket.call(this);

        this.log(new Msg(null, null, 'S', Msg.info, 'listening on port {2}', conf.port), null);

        this.processQueueInterval = setInterval(this.processQueue.bind(this), 1000);
    }

    //@todo: move to UIServer / BuildServer
    if (uiserver) {
        uiserver.listen(conf.uiport);
    }
    if (buildserver) {
        buildserver.listen(conf.port);
    }

    multiGlob.glob(this.location + '/*/build.json', this.readPreviousBuilds.bind(this));
};

/*Server.prototype.registerBuild = function (build) {
    this.builds.push(build);
    this.builds[build.id] = build;
    build.platforms.forEach(function (platformBuild) {
        this.builds[platformBuild.id] = platformBuild;
    }.bind(this));
};*/

Server.prototype.stop = function () {
    clearInterval(this.processQueueInterval);
    this.socket.server.close();
    process.exit();
};

Server.prototype.notifyStatusAllWWWs = function (kind, what, obj) {
    this.wwws.socket.emit('news', arguments.length === 1 ? kind : {
        kind: kind,
        what: what,
        obj: obj
    });
};

Server.prototype.updateBuildStatus = function (build, status, doNotLogOnMaster) {
    var buildParam = build;
    var server = this;
    if (build && !build.updateStatus) {
        //self detect build if an id was passed
        build = server.builds[build];
    }
    if (!build) {
        server.log(new Msg(null, null, 'S', Msg.error, 'Build not found with id: {2}', buildParam));
        return;
    }
    if (build.master && !doNotLogOnMaster && build.status !== status) {
        var msg = new Msg(build.master, null, 'S', Msg.status, 'Platform {2} update status: {3}', build.conf.platform, status);
        server.log(msg, null);
    }
    if (build && build.updateStatus) {
        if (status === 'deleted') {
            delete server.builds[build.id];
            server.builds.remove(build);
            server.buildsQueue.remove(build);
            if (build.master) {
                build.master.platforms.remove(build);
            } else if (build.platforms) {
                build.platforms.forEach(function (platformBuild) {
                    delete server.builds[platformBuild.id];
                    server.builds.remove(platformBuild);
                    server.buildsQueue.remove(platformBuild);
                });
            }
        } else {
            build.updateStatus(status, server.location);
        }
        server.notifyStatusAllWWWs(status, 'build', build.serialize({platforms: 1}));
    } else {
        var _msg =  "A request to change a build's status to {2} was made but that build cannot be found. " +
                    "We have tried to identify it by {3}";
        server.log(buildParam, null, 'S', Msg.error, _msg, status, buildParam);
    }
};

Server.prototype.processQueue = function () {
    var build = this.buildsQueue.shift();
    console.log(this.buildsQueue.length);
    while (build) {
        var platform = build.conf.platform;
        var startBuilding = false;
        var agents = this.platforms[platform];
        if (agents) {
            startBuilding = this.loopAgents(agents, build);
        }
        if (!startBuilding) {
            this.buildsQueue.push(build);
            build = null;
        } else {
            build = this.buildsQueue.shift();
        }
    }
};

Server.prototype.loopAgents = function (agents, build) {
    var startBuilding = false;
    agents.every(function (agent) {
        if (!agent.busy) {
            agent.startBuild(build);
            startBuilding = true;
            return false;
        }
        return true;
    });
    return startBuilding;
};

Server.prototype.log = function (msg, forwardToClientOrAgent) {
    if (this.conf.mode !== 'all' || !forwardToClientOrAgent) {
        console.log(msg.toString());
    }
    if (/Command failed/i.test(msg && msg.message)) {
        var e = new Error("server stack");
        msg.message += e.stack;
    }
    //broadcast the log to all wwws
    var build = this.findBuildById(msg.buildId);
    if (build && build.conf) {
        build.conf.logs.unshift(msg);
    }

    this.logs.unshift(msg);
    this.notifyStatusAllWWWs('log', 'log', msg);
    if (forwardToClientOrAgent) {
        forwardToClientOrAgent.emitLog(msg);
    }
};

Server.prototype.forwardLog = function (build, sender, msg, to) {
    //timestamp msg with server's time
    if (msg) {
        msg.date = new Date();
    }
    if (!to) {
        build = this.findBuildById(build);
        to = build && build.client;
    }
    if (build) {
        build.conf.logs.unshift(msg);
    }
    if (to && to !== sender) {
        to.emitLog(msg);
    }
    this.logs.unshift(msg);
    this.notifyStatusAllWWWs('log', 'log', msg);
};

Server.prototype.findBuildById = function (build) {
    if (typeof build === 'string' || build && build.id) {
        /* return found build */
        return this.builds[build && build.id || build] || build && build.id && build;
    } else {
        if (build) {
            console.error(build);
            throw "could not parse build";
        }
    }
    return build;
};

module.exports = Server;
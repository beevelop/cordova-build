/**
 * @name ServerSockets
 * @version 0.1
 * @fileoverview Defines all Server sockets (agents, clients, wwws)
 *               exclusively used by {@link Server}
 */

var Build = require('../common/Build');
var Msg = require('../common/Msg.js');
var Client = require('./Client');
var Agent = require('./Agent');
var WWW = require('./WWW');
var path = require('path');
var fs = require('fs-extra');
var http = require('http');

function ServerSockets() {
}

/**
 * AgentSocket (/agent): Handles disconnect and register events
 *
 * @param {Server} server - initiating server
 * @returns Socket
 */
ServerSockets.agentsSocket = function (server) {
    var _self = this;
    return _self.socket
        .of('/agent')
        .on('connection', function (socket) {
            var agent = new Agent(socket);
            agent.onConnect(server);
            socket.on('disconnect', function () {
                try {
                    _self.log(new Msg(agent.busy, agent, 'S', Msg.debug, 'The agent with id {0} has disconnected. Bye!'), agent.busy && agent.busy.client);
                    agent.onDisconnect();
                    server.agents.remove(agent);
                    agent.platforms.forEach(function (platform) {
                        server.platforms[platform].remove(agent);
                    });
                    if (agent.busy) {
                        var build = agent.busy;
                        _self.log(new Msg(build, agent, 'S', Msg.warning, 'the agent {3} has been disconnected. The build on {2} will be added back to queue', build.platform, agent.id), build.client);
                        build.agent = null;
                        _self.updateBuildStatus(build, 'queued');
                        var buildPath = path.resolve(_self.location, build.master && build.master.Id() || build.Id(), 'build.' + build.conf.platform + '.json');
                        build.save(buildPath, function (err) {
                            if (err) {
                                _self.log(new Msg(build, agent, 'S', Msg.debug, err), build.client);
                            }
                        });
                        if (build.master) {
                            buildPath = path.resolve(_self.location, build.master && build.master.Id(), 'build.json');
                            build.master.save(buildPath, function (err) {
                                if (err) {
                                    _self.log(new Msg(build, agent, 'S', Msg.debug, err), build.client);
                                }
                            });
                        }
                        _self.buildsQueue.push(build);
                    }
                } finally {
                    _self.notifyStatusAllWWWs('disconnected', 'agent', agent.conf);
                }
            });
            socket.on('register', function (conf) {
                agent.id = conf && conf.id;
                _self.log(new Msg(null, agent, 'S', Msg.debug, 'An agent with id {0} has just connected supporting the platforms [{2}]', agent.platforms.join(', ')), null);
                server.agents.push(agent);
                agent.platforms.forEach(function (platform) {
                    (server.platforms[platform] = server.platforms[platform] || []).push(agent);
                });
                agent.conf.platforms = agent.platforms;
                agent.conf.since = new Date();
                conf.status = 'ready';
                _self.notifyStatusAllWWWs('connected', 'agent', agent.conf);
            });
        });
};

/**
 * WWWSocket (/www): Handle rebuild and cancel requests
 *
 * @param {Server} server - initiating server
 * @returns Socket
 */
ServerSockets.wwwsSocket = function (server) {
    var _self = this;
    return _self.socket
        .of('/www')
        .on('connection', function (socket) {
            var www = new WWW(socket);
            server.wwws.push(www);
            www.onConnect(server);
            socket.on('disconnect', function () {
                www.onDisconnect();
                _self.wwws.remove(www);
            });
            socket.on('rebuild', function (build_id) {
                var build = server.builds[build_id];
                if (build) {
                    server.updateBuildStatus(build, 'queued');
                    var platforms = build.master ? [build] : build.platforms;
                    server.log(new Msg(build, build.client, 'S', Msg.status, 'This build as been rescheduled for rebuild'), build.client);

                    platforms.forEach(function (platformBuild) {
                        server.buildsQueue.push(platformBuild);
                    });
                }
            });
            socket.on('cancel', function (build_id) {
                var build = server.builds[build_id];
                if (build) {
                    server.updateBuildStatus(build, 'cancelled');
                    server.buildsQueue.remove(build);
                    if (build.client) {
                        if (build.client.socket) {
                            try {
                                build.client.socket.emit('build-failed', build.id);
                            } catch (e) {
                            }
                        }
                    }
                    server.log(new Msg(build, build.agent, 'S', Msg.error, 'The build has been cancelled on user\'s request'), build.client);
                    if (build.agent) {
                        if (build.agent.socket) {
                            try {
                                build.agent.socket.emit('cancel', build.id);
                            } catch (e) {
                            }
                        }
                        build.agent.busy = null;
                    }
                }
            });
        });
};

/**
 * ClientSocket (/client): Handle register and disconnect events
 *
 * @param {Server} server - initiating server
 * @returns Socket
 */
ServerSockets.clientsSocket = function (server) {
    var _self = this;
    return _self.socket
        .of('/client')
        .on('connection', function (socket) {
            var client = new Client(socket);
            server.clients.push(client);
            client.onConnect(server);
            socket.on('register', function (conf) {
                client.id = conf.id;
                _self.clients[conf.id] = client;
                _self.log(new Msg(null, client, 'S', Msg.debug, 'A client with id {0} has just connected. Welcome!'), client);
            });
            socket.on('disconnect', function () {
                _self.log(new Msg(null, client, 'S', Msg.debug, 'The client with id {0} has disconnected. Bye!'), client);
                client.onDisconnect();
                _self.clients.remove(client);
            });
        });
};

module.exports = Server;
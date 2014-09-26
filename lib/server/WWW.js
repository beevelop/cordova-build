/**
 * @name WWW
 * @version 1.0
 * @fileoverview Handles some of the WWW-Sockets events
 */

var fileSize = require('filesize');

/**
 * @class WWW
 */
WWW = (function() {

    /**
     * Creates a new WWW Object
     * @method WWW
     * @param {Socket} socket - the WWW socket.
     */
    function WWW(socket) {
        this.socket = socket;
    }
    
    /**
     * Set eventhandlers
     * 
     * @method onConnect
     * @return {Server} server instance of the calling {@link Server}.
     */
    WWW.prototype.onConnect = function (server) {
        this.server = server;
        this.socket.on('refresh', this.onRefresh.bind(this));
        this.socket.on('disconnect', this.onDisconnect.bind(this));
        this.onRefresh();
    };
    
    /**
     * Handle disconnect
     * 
     * @method onDisconnect
     */
    WWW.prototype.onDisconnect = function () {};
    
    /**
     * Handle refresh and update metadata (builds, agents, clients,...)
     * 
     * @method onRefresh
     */
    WWW.prototype.onRefresh = function () {
        var server = this.server;
        var response = {
            'status': 1,
            logs: server.logs,
            builds: server.builds.map(function(build) {
                return build.serialize({platforms: 1});
            }),
            agents: server.agents.map(function(agent) {
                return agent.conf;
            }),
            clients: server.clients.map(function(client) {
                return client.conf;
            }),
            latestBuild: server.latestBuild
        };
        this.socket.emit('status', response);
    };

    return WWW;
})();

module.exports = WWW;
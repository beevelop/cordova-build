var fileSize = require('filesize');

WWW = (function() {

    function WWW(socket) {
        this.socket = socket;
    }
    
    WWW.prototype.onConnect = function (server) {
        this.server = server;
        this.socket.on('refresh', this.onRefresh.bind(this));
        this.socket.on('disconnect', this.onDisconnect.bind(this));
        this.onRefresh();
    };
    
    WWW.prototype.onDisconnect = function () {};
    
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
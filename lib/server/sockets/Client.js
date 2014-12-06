var path = require('path');
var extend = require('extend');
var Build = require('../../common/Build.js');
var Msg = require('../../common/Msg.js');
var serverUtils = require('../../common/serverUtils');

function Client(socket) {
    this.socket = socket;
    socket.on('register', function(conf) {
        this.conf = conf || {};
    }.bind(this));
    socket.on('disconnect', this.onDisconnect.bind(this));
    socket.on('register-build', this.onRegisterBuild.bind(this));
    socket.on('upload-build', this.onUploadBuild.bind(this));
    socket.on('fail-build', this.onFailBuild.bind(this));
    socket.on('log', this.onLog.bind(this));
}

Client.prototype.onConnect = function(server) {
    this.server = server;
};

Client.prototype.onDisconnect = function() {
    //silence is golden
};

Client.prototype.onLog = function(msg) {
    var build = this.server.builds[msg && msg.buildId];
    var client = this;
    this.server.forwardLog(build, this, msg, {
        emitLog: function(msg) {
            if (client.server.conf.mode === 'all') {
                client.emitLog(msg);
            }
        }
    });
};

Client.prototype.onRegisterBuild = function(build) {
    var buildConf = build && build.conf;
    buildConf.started = new Date();
    if (this.validateBuildRequest(build)) {
        //from now on keep a Build object
        build = new Build(buildConf, this, null, buildConf.platform, build.files, null, build.id, null);
        this.server.builds.push(build);
        this.server.builds[build.id] = build;
        var platforms = buildConf.platform;
        build.platforms = [];
        platforms.forEach(function(platform) {
            var conf = extend(true, {}, buildConf, {number: buildConf.number && (buildConf.number + "." + platform)});
            var platformBuild = new Build(conf, this, null, platform, null, null, null, build);
            build.platforms.push(platformBuild);
            platformBuild.conf.logs = [];//separate logs from its master
            this.server.builds[platformBuild.id] = platformBuild;
        }, this);
        this.log(build, Msg.info, "The build '{0}' has been registered on: {2}", platforms.join(','));
        this.server.updateBuildStatus(build, build.conf.status);
    }
};

Client.prototype.onUploadBuild = function(build) {
    //var buildConf = build && build.conf;
    var server = this.server;
    if (this.validateBuildRequest(build)) {
        var buildObj = server.builds[build.id];
        if (!buildObj) {
            this.log(build, Msg.error, "update-build: The client said is uploading a build didn't specify a config");
            return;
        }
        //TODO: decide whether to use client's log. for now assuming no
        //buildObj.logs = build.logs;
        buildObj.files = build.files;
        //from now on keep a Build object
        build = buildObj;

        var locationPath = path.resolve(server.location, build.Id(), 'input');
        var _self = this;
        serverUtils.writeFiles(locationPath, build.files, 'the cordova build server', function (err) {
            _self.saveFiles(err, build);
        });
    }
};

Client.prototype.saveFiles = function(err, build) {
    var server = this.server;

    if (err) {
        this.log(build, Msg.error, 'The uploaded files could not be saved on the server: \n{2}', err);
        server.updateBuildStatus(build, 'failed');
    } else {
        this.log(build, Msg.status, 'Build has been queued on platforms: {2}', build.conf.platform);
        server.updateBuildStatus(build, 'queued');
        build.platforms.forEach(function(platformBuild) {
            var files = [];
            build.files.forEach(function(file) {
                if (!file.group || file.group === platformBuild.conf.platform) {
                    files.push(extend({}, file));
                }
            });
            platformBuild.files = files;
            server.updateBuildStatus(platformBuild, 'queued', true);

            server.buildsQueue.push(platformBuild);
            this.log(platformBuild, Msg.info, 'build queued on {2}', platformBuild.conf.platform);
        }, this);
    }
};

Client.prototype.onFailBuild = function(build) {
    var buildObj = this.server.builds[build && build.id];
    if (buildObj) {
        if (buildObj.platforms) {
            buildObj.platforms.forEach(function(platformBuild) {
                platformBuild.conf.status = 'failed';
            });
        }
        buildObj.conf.status = 'failed';
        this.server.updateBuildStatus(buildObj, 'failed');
    }
};

Client.prototype.log = function(build, priority, message, args) {
    if (/Command failed/i.test(message)) {
        var e = new Error("Client stack");
        message += e.stack;
    }
    Array.prototype.splice.call(arguments, 1, 0, this, 'C');
    var msg = new Msg();
    msg.update.apply(msg, arguments);

    this.server.log(msg, this);//forward to this == to the client worker
};

Client.prototype.validateBuildRequest = function(build, client) {
    var buildConf = build && build.conf;
    var server = this.server;
    if (!buildConf) {
        this.log(build, Msg.error, "The client requested a build didn't specify a config");
        this.server.updateBuildStatus(build, 'failed');
        return false;
    } else if (!buildConf.platform || !buildConf.platform.length) {
        this.log(build, Msg.error, "The client requested a build didn't specify any plaftorms to build against");
        this.server.updateBuildStatus(build, 'failed');
        return false;
    }
    Object.every(buildConf.platform, function(platform) {
        if (!platform || !server.platforms[platform] || !server.platforms[platform].length) {
            this.log(build, Msg.warning, "The client requested a build on platform '{2}', but there is no agent connected yet on that platform.", platform);
        }
        return true;
    }.bind(this));
    return true;
};

Client.prototype.emitLog = function(msg) {
    this.socket.emit('log', msg);
};

module.exports = Client;
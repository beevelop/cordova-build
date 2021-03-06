var fs = require('fs-extra');
var path = require('path');
var serverUtils = require('../../common/serverUtils');
var Msg = require('../../common/Msg.js');
var fileSize = require('filesize');
var Elapsed = require('elapsed');

function Agent(socket) {
    this.socket = socket;
    this.platforms = [];
}

Agent.prototype.onConnect = function (server) {
    this.server = server;
    this.socket.on('disconnect', this.onDisconnect.bind(this));
    this.socket.on('register', this.onRegister.bind(this));
    this.socket.on('uploading', this.onUploading.bind(this));
    this.socket.on('building', this.onBuilding.bind(this));
    this.socket.on('build-success', this.onBuildSuccess.bind(this));
    this.socket.on('build-failed', this.onBuildFailed.bind(this));
    this.socket.on('log', this.onLog.bind(this));
};

Agent.prototype.onLog = function (msg) {
    var build = this.server.builds[msg && msg.buildId];
    this.server.forwardLog(build, this, msg);
};

Agent.prototype.onDisconnect = function () {
    this.server.notifyStatusAllWWWs('disconnected', 'agent', this.conf);
};

Agent.prototype.onRegister = function (conf) {
    this.conf = conf = conf || {};
    conf.platforms = this.getUnique(((typeof conf.platforms === 'string' ? conf.platforms.split(/;|,/) : conf.platforms) || []));
    conf.platforms.forEach(function (platform) {
        this.platforms.push(platform);
    }, this);
};

Agent.prototype.onUploading = function (buildId) {
    this.server.updateBuildStatus(buildId, 'uploading');
};

Agent.prototype.onBuilding = function (buildId) {
    this.server.updateBuildStatus(buildId, 'building');
};

Agent.prototype.onBuildSuccess = function (responseBuild) {
    var build = this.server.findBuildById(responseBuild);
    if (!build) {
        return this.log(null, null, Msg.error, 'Build with id {2} is not defined on the server', responseBuild && responseBuild.id || responseBuild);
    }

    var client = build.client;
    var agent = this;
    var server = this.server;
    //var id = build.masterId || responseBuild.id;
    var locationPath = path.resolve(server.location, build.master && build.master.Id() || build.Id());

    this.log(build, client, Msg.info, 'Files received. Storing them on the server', locationPath);

    var outputFiles = responseBuild.outputFiles;
    build.outputFiles = outputFiles;
    outputFiles.forEach(function (file) {
        file.file = [build.conf.number, build.conf.number && '.' || '', file.name || path.basename(file.file)].join('');
    });
    fs.mkdirs(locationPath, function (err) {
        if (err) {
            this.log(build, client, Msg.error, 'error creating folder {2} on the cordova build server\n{3}', locationPath, err);
            this.server.updateBuildStatus(build, "failed");
        } else {
            serverUtils.writeFiles(locationPath, outputFiles, 'the cordova build agent worker output files on {0} [a]'.format(build.conf.platform), true, function (err) {
                if (err) {
                    serverUtils.freeMemFiles(build.outputFiles);
                    this.log(build, client, Msg.error, 'error saving build output files on the cordova build server\n{3}', err);
                    this.server.updateBuildStatus(build, "failed");
                } else {
                    build.conf.completed = new Date();
                    var started = build.conf.started;
                    var masterBuild = build.master;
                    server.updateBuildStatus(build, 'success');
                    build.conf.duration = new Elapsed(started, build.conf.completed).optimal;
                    //(started && started.format && started || new Date(started).elapsed(build.conf.completed));
                    if (masterBuild) {
                        if (masterBuild.platforms.every(function (platform) {
                                return platform.conf.status === 'success' || platform.conf.status === 'failed';
                            })) {
                            masterBuild.conf.completed = new Date();
                            started = masterBuild.conf.started;
                            //@TODO: fix duration bug
                            masterBuild.conf.duration = new Elapsed(started, masterBuild.conf.completed).optimal;
                            //(started && started.format && started || new Date(started).elapsed(masterBuild.conf.completed));
                            var buildPath = path.resolve(locationPath, 'build.json');
                            try {
                                var buildJSON = fs.readFileSync(buildPath, 'utf-8');
                                build.outputFiles.push({
                                    file: 'build.json',
                                    content: {data: buildJSON}
                                });
                            } catch (e) {
                                agent.log(build, client, Msg.error, buildPath + ' could not be read... continuing anyway!');
                            }
                        }
                    }
                    if (build.conf.save) {
                        agent.log(build, client, Msg.info, 'Also sending the output files to the client');
                    }

                    if (client) {
                        client.socket.emit('build-success', build.serialize({
                            outputFiles: build.conf.save,
                            content: build.conf.save
                        }));
                    }
                    agent.log(build, client, Msg.info, 'Build done, ready for a new one.');
                    serverUtils.freeMemFiles(build.outputFiles);
                    serverUtils.cleanLastFolders(server.conf.keep, server.location + "/*", function (err, stats) {
                        if (err) {
                            var _msg = 'Error while cleaning up last {2} folders in SERVER builds output folder {3}:\n{4}';
                            agent.log(build, client, Msg.debug, _msg, server.conf.keep, server.location, err);
                        }
                        var buildPath = path.resolve(locationPath, 'build.' + build.conf.platform + '.json');
                        build.save(buildPath, function (err) {
                            if (err) {
                                agent.log(build, client, Msg.debug, err);
                            }
                            agent.busy = null;//free agent to take in another work
                            agent.updateStatus('ready');
                            if (stats) {
                                stats.forEach(function (stat) {
                                    var buildId = path.basename(stat.path);
                                    var build = server.findBuildById(buildId);
                                    if (build) {
                                        server.updateBuildStatus(build, 'deleted', true);
                                    }
                                });
                            }
                        });
                    });
                }
            }.bind(this));
        }
    }.bind(this), this);
};

Agent.prototype.onBuildFailed = function (build) {
    var agent = this;
    var foundBuild = this.server.builds[build && build.id || build];
    if (foundBuild) {
        if (foundBuild.master) {
            if (foundBuild.master.platforms.every(function (platform) {
                    return platform.conf.status === 'success' || platform.conf.status === 'failed';
                })) {
                foundBuild.master.conf.completed = new Date();
            }
        }
        if (foundBuild.conf && foundBuild.conf.status !== 'failed') {
            this.server.updateBuildStatus(foundBuild, 'failed');
            this.busy = null;
            this.updateStatus('ready');
        }
        var buildPath = path.resolve(this.server.location, foundBuild.master && foundBuild.master.Id() || foundBuild.Id(), 'build.' + foundBuild.conf.platform + '.json');
        foundBuild.save(buildPath, function (err) {
            if (err) {
                agent.log(foundBuild, foundBuild.client, Msg.debug, err);
            }
        });
    } else {
        this.log(build, null, Msg.error, "The build {0} was requested to be failing but we couldn't identify such build");
    }
};

Agent.prototype.updateStatus = function (newStatus, platform) {
    this.conf.status = newStatus;
    this.conf.buildingPlatform = platform;
    this.server.notifyStatusAllWWWs('agent-status', 'agent', this.conf);
};

Agent.prototype.log = function (build, client, priority, message, args) {
    Array.prototype.splice.call(arguments, 1, 1, this, 'A');
    var msg = new Msg();
    msg.update.apply(msg, arguments);

    this.server.log(msg, client);
};

Agent.prototype.startBuild = function (build) {
    this.busy = build;
    this.updateStatus('building', build.conf.platform);
    this.server.updateBuildStatus(build, 'uploading');
    var client = build.client;
    var files = build.files;
    build.agent = this;

    this.log(build, client, Msg.debug, 'Downloading {2} file{3} from the server...', files && files.length || 0, files && files.length === 1 ? '' : 's');
    serverUtils.readFiles(files, '[AGENT.startBuild] the cordova build server\n', function (err) {
        try {
            if (err) {
                this.log(build, client, Msg.error, 'error while reading input files on the server for sending them to the agent worker: \n{2}', err);
                this.server.updateBuildStatus(build, 'failed');
                build.agent = null;
                this.busy = null;
                this.updateStatus('ready');
            } else {
                var origFilePaths = files.map(function (file) {
                    return file.file;
                });
                try {
                    var size = 0;
                    files.forEach(function (file) {
                        size += file && file.content && file.content.data && file.content.data.length || 0;
                    });
                    //only send file names to the agent worker and not full paths
                    files.forEach(function (file) {
                        file.file = path.basename(file.file);
                    });

                    this.log(build, client, Msg.info, 'sending build to agent {2} on platform {3}...{4}', this.id, build.conf.platform, fileSize(size));
                    this.socket.emit('build', build.serialize({
                        files: 1,
                        content: 1
                    }));
                } catch (e) {
                    //restore full file paths
                    this.log(build, client, Msg.error, 'error while sending build files to agent {2} on {3}...{4}', this.id, build.conf.platform, fileSize(size));
                    build.agent = null;
                    this.busy = null;
                    this.updateStatus('ready');
                } finally {
                    files.forEach(function (file, index) {
                        file.file = origFilePaths[index];
                    });
                }
            }
        } finally {
            serverUtils.freeMemFiles(files);
        }
    }.bind(this));
};

Agent.prototype.emitLog = function (msg) {
    if (/Command failed/i.test(msg && msg.message)) {
        var e = new Error("agent stack");
        msg.message += e.stack;
    }
    this.socket.emit('log', msg);
};

Agent.prototype.getUnique = function (arr) {
    var TYPE_MAP = {
        'object': 1,
        'function': 1
    };
    var map = {};
    var objects = [];
    var unique = [];
    for (var i = 0, len = arr.length; i < len; i++) {
        var val = arr[i];

        if (TYPE_MAP[typeof val] && val) {
            if (!val.__unique__) {
                unique.push(val);
                objects.push(val);
                val.__unique__ = 1;
            }
        } else if (!map[val]) {
            unique.push(val);
            map[val] = 1;
        }
    }

    for (i = objects.length; i--;) {
        delete objects[i].__unique__;
    }

    return unique;
};

module.exports = Agent;
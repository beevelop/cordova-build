/**
 * @name ClientWorker
 * @version 0.1
 * @fileoverview the client requests new builds from the server
 */

var ioc = require('socket.io/node_modules/socket.io-client');
var fs = require('fs-extra');
var path = require('path');
var extend = require('extend');
var fileSize = require('filesize');
var shortid = require('shortid');
var Elapsed = require('elapsed');
var CircularJSON = require('circular-json');
var Build = require('../common/Build.js');
var Msg = require('../common/Msg.js');
var serverUtils = require('../common/serverUtils');
var sig = 'CW';

/**
 * Initialise the ClientWorker
 *
 * @class
 * @param {Object} conf - command line options
 */
function ClientWorker(conf) {
    this.conf = conf;
    this.id = shortid.generate();
    this.url = '{0}{1}{2}/{3}'.format(conf.protocol || 'http://', conf.server, conf.port === 80 ? '' : ':' + conf.port, 'client');
    this.location = path.resolve(conf.save || 'output');
    this.parseGroupFiles(conf);
    this.built = 0;

    var _self = this;
    process.on('exit', function () {
        if (_self.socket.connected) {
            _self.socket.disconnect();
        }
        _self.socket.connected = false;
    });
}

/**
 * Connect to the server (create new socket)
 * and attach Listeners
 */
ClientWorker.prototype.connect = function () {
    if (!this.socket) {
        this.socket = ioc.connect(this.url, {
            'reconnect': false,
            'force new connection': true, // <-- Add this!
            'sync disconnect on unload': true
        });
        this.socket.on('connect', this.onConnect.bind(this));
        this.socket.on('disconnect', this.onDisconnect.bind(this));
        this.socket.on('error', this.onError.bind(this));
        this.socket.on('build-success', this.onBuildSuccess.bind(this));
        this.socket.on('build-failed', this.onBuildFailed.bind(this));
        this.socket.on('log', function (msg) {
            var message = new Msg(msg);
            console.log(message.toString());
        }.bind(this));
    }
};

/**
 * Handle socket errors
 *
 * @param {Object} [err] - error object or null
 */
ClientWorker.prototype.onError = function (err) {
    console.log('Client Worker socket reported error:', err);
    if (this.conf.mode !== 'all' && !this.conf.agent) {
        console.log('Nothing to do. Exiting...');
        process.exit(1);
    } else {
        if (this.conf.agent) {
            var _msg = "However this process won't close because there is an agent worker on {0} which will be trying to reconnect";
            console.log(_msg.format(this.conf.agent));
        }
    }
};

/**
 * Register client, create Build and initialise file uploads
 */
ClientWorker.prototype.onConnect = function () {
    console.log('CLIENT CONNECTED requesting build on {0}'.format(this.conf.build));
    var client = this;
    var files = this.files;
    var platforms = this.conf.build;
    if (this.conf.number && this.conf.number.indexOf && this.conf.number.indexOf('0.') === 0) {
        this.conf.number = this.conf.number.substr(2);
    }
    var build = this.build = new Build({
        logs: [],
        status: 'uploading',
        name: this.conf.name,
        number: this.conf.number,
        started: new Date()
    }, client, null, platforms, files);
    build.id = client.id;
    extend(build.conf, this.conf);
    delete build.conf.agent;
    delete build.conf.serverInstance;
    console.log(build.conf);
    build.conf.logs.push(new Msg(build, this, sig, Msg.info, "The build is requested on {2}", platforms));

    client.socket.emit('register', {
        id: client.id,
        save: !!this.conf.save
    });
    if (!this.buildCompleted) {
        client.socket.emit('register-build', build.serialize());
        this.log(build, Msg.info, 'Reading {2} file{3}...', files.length, files.length === 1 ? '' : 's');
        serverUtils.readFiles(files, 'the servers-side sister of the cordova build client', this.uploadFiles.bind(this));
    }
};

/**
 * Upload build files to server and free memory afterwards
 *
 * @param {Object} [err] - error object or null
 */
ClientWorker.prototype.uploadFiles = function (err) {
    if (err) {
        this.log(this.build, Msg.error, 'Error reading the input files\n{0}'.format(err));
        this.socket.emit('fail-build', build.serialize());
        throw 'Error reading the input files\n{0}'.format(err);
    }

    try {
        //registering the client, sends our client id
        var size = 0;
        this.files.forEach(function (file) {
            size += file && file.content && file.content.data && file.content.data.length || 0;
        });
        if (size) {
            this.log(this.build, Msg.info, 'Uploading files to cordova build server...{2}', fileSize(size));
        }
        var serializedBuild = this.build.serialize({files: 1, content: 1});
        this.socket.emit('upload-build', serializedBuild);
    } finally {
        //free agent's memory of output files contents
        serverUtils.freeMemFiles(this.files);
    }
};

/**
 * Exits the process when socket disconnects
 */
ClientWorker.prototype.onDisconnect = function () {
    console.log('CLIENT DISCONNECTED');
    if (!this.conf.listen.server && !this.conf.listen.agent && !this.conf.listen.git) {
        process.exit();//the client worker should exit
    }
};

/**
 * Disconnect the client when build fails
 */
ClientWorker.prototype.onBuildFailed = function () {
    var client = this;
    if (++client.built >= client.conf.build.length) {
        client.disconnect();
    }
};

/**
 * Disconnect the the socket and exit process
 */
ClientWorker.prototype.disconnect = function () {
    try {
        this.buildCompleted = true;
        console.log('Client is disconnecting from the server since the build tasks completed.');
        this.socket.disconnect();
    } catch (e) {
        //@TODO: error-handling
    } finally {
        if (!this.conf.listen.server && !this.conf.listen.agent && !this.conf.listen.git) {
            process.exit(0);
        }
    }
};

/**
 * Save outputfiles and build logs
 *
 * @param {Build} build - the suceeded build
 */
ClientWorker.prototype.onBuildSuccess = function (build) {
    var client = this;
    this.succBuild = build;
    if (this.conf.save) {
        //var id = build.masterId || build.id;
        var files = build.outputFiles;
        var locationPath = path.resolve(client.location, build.id);//path.resolve(client.location, this.build.Id());
        this.buildPath = path.resolve(locationPath, 'build.' + build.conf.platform + '.json');

        serverUtils.writeFiles(locationPath, files, 'the cordova build client {0}'.format(build.conf.platform), function (err) {
            if (err) {
                client.log(build, Msg.error, 'error saving build output files on the cordova build server\n{3}', err);
                return client.onBuildFailed();
            }
            serverUtils.cleanLastFolders(client.conf.keep, client.location + "/*", client.saveBuildLog.bind(client));
        });
    } else {
        this.done();
    }
};

/**
 * Write logfiles
 *
 * @param {Object} [err] - error object or null
 */
ClientWorker.prototype.saveBuildLog = function (err) {
    if (err) {
        this.log(this.succBuild, Msg.debug, 'Error while cleaning up last {2} folders in CLIENT output folder {3}:\n{4}', this.conf.keep, this.location, err);
    }
    fs.writeFile(this.buildPath, CircularJSON.stringify(this.succBuild, null, 4), this.done.bind(this));
};

/**
 * Free memory and disconnect if all builds are done
 *
 * @param {Object} [err] - error object or null
 */
ClientWorker.prototype.done = function (err) {
    if (err) {
        this.log(this.succBuild, Msg.debug, 'Error while saving {2}:\n{3}', this.buildPath, err);
    }
    if (this.succBuild.outputFiles) {
        serverUtils.freeMemFiles(this.succBuild.outputFiles);
    }
    this.log(this.succBuild, Msg.info, 'Build done! It took {2}.', new Date(this.succBuild.conf.started).elapsed());
    if (++this.built >= this.conf.build.length) {
        this.disconnect();
    }
};

/**
 * Output to console and emit to server
 *
 * @param {Build} build    - the build which the log message refers to
 * @param {int} priority   - priority of the log message (1-6)
 * @param {String} message - the log message
 * @param {*} args         - any additional arguments (passed to Msg.update
 */
ClientWorker.prototype.log = function (build, priority, message, args) {
    if (/Command failed/i.test(message)) {
        try {
            throw new Error("client worker stack");
        } catch (e) {
            message += e.stack;
        }
    }
    Array.prototype.splice.call(arguments, 1, 0, this, sig);
    var msg = new Msg();
    msg.update.apply(msg, arguments);

    if (!this.socket.connected) {
        console.log(msg.toString());
    } else {
        this.socket.emit('log', msg);
    }
};

/**
 * Parse the groupfiles (according to conf.platforms)
 *
 * @param {Object} conf - command line options
 */
ClientWorker.prototype.parseGroupFiles = function (conf) {
    var groups = ['files'].concat(conf.platforms);
    var files = [];
    groups.forEach(function (group, isGroup) {
        conf[group].forEach(function (file) {
            var f = file.split(/;|,/);
            f.forEach(function (file) {
                if (file.length !== 0) {
                    files.push({file: file, group: isGroup ? group : null});
                }
            });
        });
    });
    this.files = files;
};

module.exports = ClientWorker;
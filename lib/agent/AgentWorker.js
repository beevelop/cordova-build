/**
 * @name AgentWorker
 * @version 0.1
 * @fileoverview the agent processes builds ordered by the server
 */

var shortid = require('shortid');
var fileSize = require('filesize');
var multiGlob = require('multi-glob');
var ioc = require('socket.io/node_modules/socket.io-client');
var fs = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var splice = Array.prototype.splice;

var Build = require('../common/Build');
var Msg = require('../common/Msg');
var serverUtils = require('../common/serverUtils');
var Archiver = require('../common/Archiver');
var Android = require('./Android');
var IOS = require('./IOS');
var WP8 = require('./WP8');

/**
 * Initialize the AgentWorker
 *
 * @class
 * @param {Object} conf - command line options
 */
function AgentWorker(conf) {
    this.id = shortid.generate();
    this.conf = conf || {};
    this.url = '{0}/{1}'.format(conf.url, 'agent');
    this.workFolder = conf.agentwork || 'work';

    this.archiver = new Archiver(conf["7zpath"]);

    process.on('exit', function () {
        if (this.socket.connected) {
            this.socket.disconnect();
        }
        this.socket.connected = false;
    }.bind(this));
}

/**
 * Connect to the server (create new socket)
 * and attach listeners
 */
AgentWorker.prototype.connect = function () {
    if (this.socket) {
        this.socket.connect();
        return;
    }

    console.log('Connecting agent supporting', this.conf.agent, 'to:', this.url);
    this.socket = ioc.connect(this.url, {
        'max reconnection attempts': Infinity,
        'force new connection': true,
        'reconnect': true,
        'reconnection limit': Infinity,
        'sync disconnect on unload': true,
        'reconnection delay': 500
    });

    this.attachListeners();
    this.ensureWorkFolder();
};

/**
 * Attach socket listeners
 */
AgentWorker.prototype.attachListeners = function () {
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('disconnect', this.onDisconnect.bind(this));
    this.socket.on('error', this.onError.bind(this));
    this.socket.on('build', this.onBuild.bind(this));
    this.socket.on('cancel', this.onCancelBuild.bind(this));
    this.socket.on('log', function (msg) {
        console.log(new Msg(msg).toString());
    });
    this.socket.on('reconnecting', function (attempt) {
        console.log("Reconnecting, attempt #" + attempt);
    });
    this.socket.on('reconnect', function (attempt) {
        console.log("AgentWorker successfully reconnected on attempt #" + attempt);
    });
};


/**
 * Register to the server
 */
AgentWorker.prototype.onConnect = function () {
    console.log('AgentWorker connected! Supporting platforms: ', this.conf.agent);
    this.emit('register', {
        id: this.id,
        name: this.conf.agentname,
        platforms: this.conf.agent || ['android', 'wp8']
    });
};

/**
 * Log socket disconnects
 */
AgentWorker.prototype.onDisconnect = function () {
    console.log('AgentWorker diconnected! Affected platforms: ', this.conf.agent);
};

/**
 * Log socket errors
 *
 * @param {Object} err - error object
 */
AgentWorker.prototype.onError = function (err) {
    console.log('Agent Worker will attempt to reconnect because it the socket reported an error:', err);
};

/**
 * Set build status
 */
AgentWorker.prototype.onCancelBuild = function () {
    this.build.conf.status = 'cancelled';
    try {
        if (this.exec) {
            this.exec.kill();
        }
    } catch (e) {
        //@TODO; error-handling ?
    }
};

/**
 * Initialise new build (via platform specific build sequences)
 *
 * @param {Build} build - the build object
 */
AgentWorker.prototype.onBuild = function (build) {
    if (!build) {
        return this.buildFailed(build, 'No build configuration was specified!');
    }
    if (!build.conf || !build.conf.platform) {
        return this.buildFailed(build, 'No platform was specified for the requested build!');
    }
    this.emit('building', build.id);
    var buildObj = new Build(build.conf, null, this, build.conf.platform, build.files, null, build.id, build.masterId);
    this.build = build = buildObj;
    build.locationPath = this.conf.reuseworkfolder ? path.resolve(this.workFolder) : path.resolve(this.workFolder, build.Id());

    switch (build.conf.platform) {
        case 'wp8':
            var wp8 = new WP8(build, this);
            wp8.init.apply(wp8);
            break;
        case 'android':
            var a = new Android(build, this);
            a.init.apply(a);
            break;
        case 'ios':
            var ios = new IOS(build, this);
            ios.init.apply(ios);
            break;
        default:
            this.buildFailed(build, "Platform '{2}' was requested for this build but this agent doesn't support it!", build.conf.platform);
            break;
    }
};

/**
 * Wrapper function for socket emit
 */
AgentWorker.prototype.emit = function () {
    if (!this.build || this.build.conf && this.build.conf.status !== 'cancelled') {
        return this.socket.emit.apply(this.socket, arguments);
    }
    return false;
};

/**
 * Output to console and emit to server
 *
 * @param {Build} build    - the build which the log message refers to
 * @param {int} priority   - priority of the log message (1-6)
 * @param {String} message - the log message
 * @param {*} args         - any additional arguments (passed to Msg.update
 */
AgentWorker.prototype.log = function (build, priority, message, args) {
    if (/Command failed/i.test(message)) {
        var e = new Error("agent worker stack");
        message += e.stack;
    }
    splice.call(arguments, 1, 0, this, 'AW');
    var msg = new Msg();
    msg.update.apply(msg, arguments);

    if (this.conf.mode !== 'all' || !this.socket.connected) {
        console.log(msg.toString());
    }
    this.emit('log', msg);
};

/**
 * Ensuring the agent's workfolder exists (create it if necessary)
 *
 * @param {function} done - callback function
 */
AgentWorker.prototype.ensureWorkFolder = function (done) {
    var workFolder = this.workFolder = path.resolve(this.workFolder);
    var agent = this;

    fs.mkdirs(workFolder, function (err) {
        if (err) {
            agent.log(null, Msg.error, 'Cannot create folder: {2}', workFolder);
            process.env.PWD = workFolder;
        }
        if (done) {
            done(err, workFolder);
        }
    });
};

/**
 * Wrapper function to log and interact with command execution
 *
 * @param {Build} build          - concerning build
 * @param {String} cmd           - command to execute
 * @param {Object} opts          - options passed to the exec command
 * @param {function} callback    - callback function
 * @param {String} exitCodeError - error message
 */
AgentWorker.prototype.exec = function (build, cmd, opts, callback, exitCodeError) {
    var agent = this;
    var process = exec(cmd, opts, function (err, stdout, stderr) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        if (stdout) {
            agent.log(build, Msg.buildLog, '{2}', stdout);
        }
        if (err && (!err.code || err.code !== 1)) {
            agent.log(build, Msg.error, 'error:\n{2}', err);
        }
        if (stderr && (err && err.message || '').indexOf(stderr) < 0) {
            agent.log(build, Msg.error, 'stderror:\n{2}', stderr);
        }
        callback.apply(agent, arguments);
        if (stderr || err && (!err.code || err.code !== 1)) {
            return agent.buildFailed(build, '');
        }
    }).on('close', function (code) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        if (code && code !== 1) {
            return agent.buildFailed(build, exitCodeError || 'process exited with error code {2}', code);
        }
    });
    process.stdout.on('data', function (data) {
        if ((/error\:/gi).test(data || '')) {
            return agent.buildFailed(build, data);
        }
        agent.log(build, Msg.buildLog, data);
    });
    process.stderr.on('data', function (data) {
        agent.log(build, Msg.error, data);
    });
    return process;
};

/**
 * Initialise upload of succeded build
 *
 * @param {Build} build - current build
 * @param {Array} globFiles - array of globs to upload
 */
AgentWorker.prototype.buildSuccess = function (build, globFiles) {
    if (build.conf.status === 'cancelled') {
        return;
    }

    var agent = this;
    var workFolder = build.locationPath;
    multiGlob.glob(globFiles, {
        cwd: workFolder
    }, function (err, files) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        if (err) {
            return agent.buildFailed(build, 'error globbing {2}', globFiles);
        }
        files = files.map(function (file) {
            return {file: path.resolve(workFolder, file)};
        });
        agent.emit('uploading', build.id);//change build status to uploading..
        serverUtils.readFiles(files, '[Agent WORKER] cordova build agent worker output files', function (err) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                serverUtils.freeMemFiles(files);
                return agent.buildFailed(build, err);
            }
            agent.uploadFiles(build, files);
        });
    });
};

/**
 * Upload outputFiles to the server
 *
 * @param {Build} build - current build
 * @param {Object} outputFiles - list of files to upload
 */
AgentWorker.prototype.uploadFiles = function (build, outputFiles) {
    var _self = this;
    try {
        build.outputFiles = outputFiles;
        var size = 0;
        outputFiles.forEach(function (file) {
            size += file && file.content && file.content.data && file.content.data.length || 0;
        });
        if (size) {
            _self.log(build, Msg.info, 'Uploading results file(s) to cordova build server...{0}'.format(fileSize(size)));
        }
        var paths = [];
        outputFiles.forEach(function (file) {
            paths.push(file.file);
            if (build.conf.name) {
                var ext = path.extname(file.file);
                switch (ext) {
                    case '.ipa':
                    case '.apk':
                    case '.xap':
                        file.name = build.conf.name ? build.conf.name + ext : file.file;
                        break;
                }
            }
            file.file = path.basename(file.file);
        });

        _self.emit('build-success', build.serialize({
            outputFiles: 1,
            content: 1
        }));
        outputFiles.forEach(function (file, index) {
            file.file = paths[index];
        });
    } finally {
        //free agent's memory of output files contents
        serverUtils.freeMemFiles(outputFiles);
        var buildPath = path.resolve(build.locationPath, 'build.' + build.conf.platform + '.json');
        build.save(buildPath, function (err) {
            if (err) {
                _self.log(build, Msg.debug, err);
            }
        });
    }
};

/**
 * Handle build files (report to the server and upload logfiles)
 *
 * @param {Build} build - current build
 * @param {Object} [err] - error object (build failed) or null
 * @param {*} args - any additional arguments (passed to {@link AgentWorker#log}
 */
AgentWorker.prototype.buildFailed = function (build, err, args) {
    if (build.conf.status === 'cancelled') {
        return;
    }

    var e = new Error("failed with stack");
    err = err + '\n' + e.stack;

    var agent = this;
    if (err) {
        splice.call(arguments, 1, 0, Msg.error);
        this.log.apply(this, arguments);
        this.log.call(this, build, Msg.error, '*** BUILD FAILED on {2} ***', build && build.conf && build.conf.platform || 'unknown platform');
    }

    serverUtils.freeMemFiles(build.files);
    var buildPath = path.resolve(build.locationPath, 'build.' + build.conf.platform + '.json');
    build.save(buildPath, function (err) {
        if (err) {
            agent.log(build, Msg.debug, err);
        }
    });
    this.emit('build-failed', build.serialize());
};

module.exports = AgentWorker;
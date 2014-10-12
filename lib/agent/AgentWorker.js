module.exports = AgentWorker;

var $ = require('stringformat');
var os = require('os');
var async = require('async');
var shortid = require('shortid');
var fileSize = require('filesize');
var multiGlob = require('multi-glob');
var unzip = require('unzip');
var ioc = require('socket.io/node_modules/socket.io-client');
var fs = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var Build = require('../common/Build.js');
var Msg = require('../common/Msg.js');
var splice = Array.prototype.splice;
var serverUtils = require('../common/serverUtils');
var maxBuffer = 524288;
var tee = path.resolve(__dirname, '../../bin/tee.exe');
var egrep = path.resolve(__dirname, '../../bin/egrep.exe');
var Android = require('./Android');
var iOS = require('./iOS');
var WP8 = require('./WP8');
var zipArchiver;

function AgentWorker(conf) {
    this.id = shortid.generate();
    this.conf = conf || {};
    this.sevenZipPath = conf["7zpath"] || "7z";
    this.url = '{0}{1}{2}/{3}'.format(conf.protocol || 'http://', conf.server, conf.port === 80 ? '' : ':' + conf.port, 'agent');
    this.workFolder = conf.agentwork || 'work';

    process.on('exit', function () {
        if (this.socket.connected) {
            this.socket.disconnect();
        }
        this.socket.connected = false;
    }.bind(this));
}

AgentWorker.define({
    connect: function () {
        var conf = this.conf;
        if (!this.socket) {
            console.log('Connecting agent supporting', conf.agent, 'to:', this.url);
            this.socket = ioc.connect(this.url, {
                'max reconnection attempts': Infinity,
                'force new connection': true, // <-- Add this!
                'reconnect': true,
                'reconnection limit': Infinity,
                'sync disconnect on unload': true,
                'reconnection delay': 500
            });
            this.socket.on('connect', this.onConnect.bind(this));
            this.socket.on('disconnect', this.onDisconnect.bind(this));
            this.socket.on('error', this.onError.bind(this));
            this.socket.on('build', this.onBuild.bind(this));
            this.socket.on('cancel', this.onCancelBuild.bind(this));
            this.socket.on('log', function (msg) {
                var message = new Msg(msg);
                console.log(message.toString());
            }.bind(this));
            this.socket.on('reconnecting', function (attempt) {
                console.log("Reconnecting, attempt #" + attempt);
            }.bind(this));
            this.socket.on('reconnect', function (attempt) {
                console.log("Agent successfully reconnected on attempt #" + attempt);
            }.bind(this));

            this.ensureWorkFolder();
            this.detectZipArchiver();
        } else {
            this.socket.connect();
        }
    },
    'onConnect': function () {
        console.log('AGENT WORKER CONNECTED supporting platforms:', this.conf.agent);
        this.emit('register', {
            id: this.id,
            name: this.conf.agentname,
            platforms: this.conf.agent || ['android', 'wp8']
        });
    },
    'onDisconnect': function () {
        console.log('AGENT WORKER DISCONNECTED with platforms:', this.conf.agent);
    },
    'onError': function (err) {
        console.log('Agent Worker will attempt to reconnect because it the socket reported an error:', err);
    },
    'onCancelBuild': function () {
        this.build.conf.status = 'cancelled';
        try {
            if (this.exec) {
                this.exec.kill();
            }
        } catch (e) {
            //@TODO; error-handling ?
        }
    },
    'onBuild': function (build) {
        if (!build) {
            return this.buildFailed(build, 'No build configuration was specified!');
        }
        if (!build.conf || !build.conf.platform) {
            return this.buildFailed(build, 'No platform was specified for the requested build!');
        }
        this.emit('building', build.id);
        var buildObj = new Build(build.conf, null, this, build.conf.platform, build.files, null, build.id, build.masterId);
        this.build = build = buildObj;
        this.computeLocationFolder(build);
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
                var ios = new iOS(build, this);
                ios.init.apply(ios);
                break;
            default:
                this.buildFailed(build, "Platform '{2}' was requested for this build but this agent doesn't support it!", build.conf.platform);
                break;
        }
    },
    emit: function () {
        if (!this.build || this.build.conf && this.build.conf.status !== 'cancelled') {
            return this.socket.emit.apply(this.socket, arguments);
        }
        return false;
    },
    log: function (build, priority, message, args) {
        if (/Command failed/i.test(message)) {
            try {
                throw new Error("agent worker stack");
            } catch (e) {
                message += e.stack;
            }
        }
        splice.call(arguments, 1, 0, this, 'AW');
        var msg = new Msg();
        msg.update.apply(msg, arguments);

        if (this.conf.mode !== 'all' || !this.socket.connected) {
            console.log(msg.toString());
        }
        this.emit('log', msg);
    },
    ensureWorkFolder: function (done) {
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
    },
    detectZipArchiver: function () {
        var agent = this;
        exec(agent.sevenZipPath || '7z', {maxBuffer: maxBuffer}, function (err) {
            if (!err) {
                zipArchiver = '7z';
            } else {
                exec('"C:\\Program Files\\7-Zip\\7z.exe"', {maxBuffer: maxBuffer}, function (err) {
                    if (!err) {
                        zipArchiver = '7z64';
                        if (agent.sevenZipPath === "7z") {
                            agent.sevenZipPath = '"C:\\Program Files\\7-Zip\\7z.exe"';
                        }
                    } else {
                        exec('/Applications/Keka.app/Contents/Resources/keka7z', {maxBuffer: maxBuffer}, function (err) {
                            if (!err) {
                                zipArchiver = 'keka7z';
                            } else {
                                zipArchiver = 'unzip';
                            }
                        });
                    }
                });
            }
        });
    },
    modifyArchive: function (build, modifier, file, spaceSeparatedNames, opts, done) {
        var agent = this;
        var verb = modifier === 'a' ? 'adding' : 'removing';
        var into = modifier === 'a' ? 'to' : 'from';
        var errMsg = 'Error {2} {3} {4} archive via {5}\n{6}\n{7}';
        switch (zipArchiver) {
            case '7z':
            case '7z64':
                exec('{0} {1} -tzip {2} {3}'.format(agent.sevenZipPath, modifier, file, spaceSeparatedNames), opts, function (err, stdout, stderr) {
                    if (build.conf.status === 'cancelled') {
                        return;
                    }
                    //stdout && agent.log(build, Msg.debug, '{2}', stdout);
                    if (err) {
                        return agent.buildFailed(build, errMsg, verb, spaceSeparatedNames, into, agent.sevenZipPath, err, stderr);
                    }
                    done();
                });
                break;
            case 'keka7z':
                exec('/Applications/Keka.app/Contents/Resources/keka7z d -tzip {0} {1}'.format(file, spaceSeparatedNames), opts, function (err, stdout, stderr) {
                    if (build.conf.status === 'cancelled') {
                        return;
                    }
                    //stdout && agent.log(build, Msg.debug, '{2}', stdout);
                    if (err) {
                        return agent.buildFailed(build, errMsg, verb, spaceSeparatedNames, into, 'keka7z', err, stderr);
                    }
                    done();
                });
                break;
                //case 'unzip':
                //    exec('unzip -uo {0} -d {1} '.format(file, target), opts, function (err, stdout, stderr) {
                //        stdout && agent.log(build, Msg.debug, '{2}', stdout);
                //        if (err || stderr) return agent.buildFailed(build, 'error executing unzip\n{2}\n{3}', err, stderr);
                //        done();
                //    });
                //    break;
            default:
                return agent.buildFailed(build, 'cannot find 7z: {2}', zipArchiver || 'searched {0}, /Applications/Keka.app/Contents/Resources/keka7z'.format(this.sevenZipPath));
        }
    },
    extractArchive: function (build, file, target, opts, done) {
        var agent = this;
        switch (zipArchiver) {
            case '7z':
            case '7z64':
                var cmd = '{0} x {1} -o{2} -y'.format(agent.sevenZipPath, file, target);
                exec(cmd, opts, function (err, stdout, stderr) {
                    if (build.conf.status === 'cancelled') {
                        return;
                    }
                    //stdout && agent.log(build, Msg.debug, '{2}', stdout);
                    if (err) {
                        return agent.buildFailed(build, 'Error executing {2}:\nCMD:{3}\nOpts:{4}\nStdout:{5}\nErr:{6}\nStdErr:{7}', agent.sevenZipPath, cmd, JSON.stringify(opts), stdout, err, stderr);
                    }
                    done();
                });
                break;
            case 'keka7z':
                exec('/Applications/Keka.app/Contents/Resources/keka7z x {0} -o{1} -y'.format(file, target), opts, function (err, stdout, stderr) {
                    if (build.conf.status === 'cancelled') {
                        return;
                    }
                    //stdout && agent.log(build, Msg.debug, '{2}', stdout);
                    if (err) {
                        return agent.buildFailed(build, 'error executing keka7z\n{2}\n{3}', err, stderr);
                    }
                    done();
                });
                break;
            case 'unzip':
                var extrator = unzip.Extract({path: path.resolve(target)});
                fs.createReadStream(file).pipe(extrator);
                extrator.on('error', function (err) {
                    if (err) {
                        return agent.buildFailed(build, 'Error unzipping {2}:\nTarget:{3}\nErr:{4}', file, target, err);
                    } else {
                        return agent.buildFailed(build, 'Error unzipping {2}:\nTarget:{3}\nError is not available!', file, target);
                    }
                });
                extrator.on('close', function () {
                    if (build.conf.status === 'cancelled') {
                        return;
                    }
                    done();
                });
                break;
            default:
                return agent.buildFailed(build, 'cannot find 7z: {2}', zipArchiver || 'searched 7z, /Applications/Keka.app/Contents/Resources/keka7z');
        }
    },
    computeLocationFolder: function (build) {
        var agent = this;
        build.locationPath = agent.conf.reuseworkfolder ? path.resolve(agent.workFolder) : path.resolve(agent.workFolder, build.Id());
    },
    exec: function (build, cmd, opts, callback, exitCodeError) {
        var agent = this;
        var process = exec(cmd, function (err, stdout, stderr) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (stdout) {
                agent.log(build, Msg.build_output, '{2}', stdout);
            }
            if (err) {
                if (!err.code || err.code !== 1) {
                    agent.log(build, Msg.error, 'error:\n{2}', err);
                }
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
            agent.log(build, Msg.build_output, data);
        });
        process.stderr.on('data', function (data) {
            agent.log(build, Msg.error, data);
        });
        return process;
    },
    buildSuccess: function (build, globFiles) {
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
                uploadFiles(files);
            });
        });
        function uploadFiles(outputFiles) {
            try {
                build.outputFiles = outputFiles;
                var size = 0;
                outputFiles.forEach(function (file) {
                    size += file && file.content && file.content.data && file.content.data.length || 0;
                });
                if (size) {
                    agent.log(build, Msg.info, 'Uploading results file(s) to cordova build server...{0}'.format(fileSize(size)));
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

                agent.emit('build-success', build.serialize({
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
                build.save(buildPath, function (err, e, bp, json) {
                    if (err) {
                        agent.log(build, Msg.debug, err);
                    }
                });
            }
        }
    },
    buildFailed: function (build, err, args) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        try {
            throw new Error("failed with stack");
        } catch (e) {
            err = err + '\n' + e.stack;
        }
        var agent = this;
        if (err) {
            splice.call(arguments, 1, 0, Msg.error);
            this.log.apply(this, arguments);
            this.log.call(this, build, Msg.error, '*** BUILD FAILED on {2} ***', build && build.conf && build.conf.platform || 'unknown platform');
        }

        serverUtils.freeMemFiles(build.files);
        var buildPath = path.resolve(build.locationPath, 'build.' + build.conf.platform + '.json');
        build.save(buildPath, function (err, e, bp, json) {
            if (err) {
                agent.log(build, Msg.debug, err);
            }
        });
        this.emit('build-failed', build.serialize());
    }
});
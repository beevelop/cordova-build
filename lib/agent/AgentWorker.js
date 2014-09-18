module.exports = AgentWorker;

var $ = require('stringformat'),
        os = require('os'),
        async = require('async'),
        shortid = require('shortid'),
        fileSize = require('filesize'),
        multiGlob = require('multi-glob'),
        unzip = require('unzip'),
        ioc = require('socket.io/node_modules/socket.io-client'),
        fs = require('fs-extra'),
        path = require('path'),
        exec = require('child_process').exec,
        Build = require('../common/Build.js'),
        Msg = require('../common/Msg.js'),
        splice = Array.prototype.splice,
        serverUtils = require('../common/serverUtils'),
        maxBuffer = 524288,
        tee = path.resolve(__dirname, '../../bin/tee.exe'),
        egrep = path.resolve(__dirname, '../../bin/egrep.exe'),
        Android = require('./Android'),
        iOS = require('./iOS'),
        WP8 = require('./WP8'),
        zipArchiver;


function AgentWorker(conf) {
    this.id = shortid.generate();
    this.conf = conf || {};
    this.sevenZipPath = conf["7zpath"] || "7z";
    this.url = '{0}{1}{2}/{3}'.format(conf.protocol || 'http://', conf.server, conf.port == 80 ? '' : ':' + conf.port, 'agent');
    this.workFolder = conf.agentwork || 'work';

    process.on('exit', function() {
        this.socket.socket.connected && this.socket.disconnect();
        this.socket.socket.connected = false;
    }.bind(this));
}

AgentWorker.define({
    connect: function() {
        var conf = this.conf;
        if (!this.socket) {
            console.log('Connecting agent supporting', conf.agent, 'to:', this.url);
            this.socket = ioc.connect(this.url, {
                'max reconnection attempts': Infinity,
                'force new connection': true, // <-- Add this!
                'reconnect': true,
                'reconnection limit': Infinity,
                'sync disconnect on unload': true
            }).on({
                'connect': this.onConnect,
                'disconnect': this.onDisconnect,
                'error': this.onError,
                'build': this.onBuild,
                'cancel': this.onCancelBuild,
                'log': function(msg) {
                    var message = new Msg(msg);
                    console.log(message.toString());
                }
            }, this);
            this.ensureWorkFolder();
            this.detectZipArchiver();
        }
        else {
            this.socket.reconnect();
        }
    },
    'onConnect': function() {
        console.log('AGENT WORKER CONNECTED supporting platforms:', this.conf.agent);
        this.emit('register', {
            id: this.id,
            name: this.conf.agentname,
            platforms: this.conf.agent || ['android', 'wp8']
        });
    },
    'onDisconnect': function() {
        console.log('AGENT WORKER DISCONNECTED with platforms:', this.conf.agent);
    },
    'onError': function(err) {
        //if (err && (err.code == 'ETIMEDOUT'err.code == 'ECONNREFUSED' || err.indexOf && err.indexOf('ECONNREFUSED') >= 0)) {
        if (!this._reconnecting) {
            console.log('Agent Worker will attempt to reconnect because it the socket reported an error:', err);
            var self = this;
            this._reconnecting = function() {
                self.socket.socket.reconnect();
            }.defer(500);
            self.socket.on('connect', function() {
                clearTimeout(self._reconnecting);
                self._reconnecting = 1;
                self.socket.removeListener('connect', arguments.callee);
            });
        }
    },
    'onCancelBuild': function() {
        this.build.conf.status = 'cancelled';
        try {
            this.exec && this.exec.kill();
        } catch (e) {
            //@TODO; error-handling ?
        }
    },
    'onBuild': function(build) {
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
    emit: function() {
        if (!this.build || this.build.conf && this.build.conf.status != 'cancelled') {
            return this.socket.emit.apply(this.socket, arguments);
        }
        return false;
    },
    log: function(build, priority, message, args) {
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

        if (this.conf.mode != 'all' || !this.socket.socket.connected) {
            console.log(msg.toString());
        }
        this.emit('log', msg);
    },
    ensureWorkFolder: function(done) {
        var workFolder = this.workFolder = path.resolve(this.workFolder);
        var agent = this;

        fs.mkdirs(workFolder, function(err) {
            if (err) {
                agent.log(null, Msg.error, 'Cannot create folder: {2}', workFolder);
                process.env.PWD = workFolder;
            }
            done && done(err, workFolder);
        });
    },
    detectZipArchiver: function() {
        var agent = this;
        var zipper = exec(agent.sevenZipPath || '7z', {maxBuffer: maxBuffer}, function(err) {
            if (!err) {
                zipArchiver = '7z';
            } else {
                exec('"C:\\Program\ Files\\7-Zip\\7z.exe"', {maxBuffer: maxBuffer}, function(err) {
                    if (!err) {
                        zipArchiver = '7z64';
                        if (agent.sevenZipPath == "7z") {
                            agent.sevenZipPath = '"C:\\Program\ Files\\7-Zip\\7z.exe"';
                        }
                    } else {
                        zipper = exec('/Applications/Keka.app/Contents/Resources/keka7z', {maxBuffer: maxBuffer}, function(err) {
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
    modifyArchive: function(build, modifier, file, spaceSeparatedNames, opts, done) {
        var agent = this;
        var verb = modifier == 'a' ? 'adding' : 'removing';
        var into = modifier == 'a' ? 'to' : 'from';
        var errMsg = 'Error {2} {3} {4} archive via {5}\n{6}\n{7}';
        switch (zipArchiver) {
            case '7z':
            case '7z64':
                var zipper = exec('{0} {1} -tzip {2} {3}'.format(agent.sevenZipPath, modifier, file, spaceSeparatedNames), opts, function(err, stdout, stderr) {
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
                var zipper = exec('/Applications/Keka.app/Contents/Resources/keka7z d -tzip {0} {1}'.format(file, spaceSeparatedNames), opts, function(err, stdout, stderr) {
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
    extractArchive: function(build, file, target, opts, done) {
        var agent = this;
        switch (zipArchiver) {
            case '7z':
            case '7z64':
                var cmd = '{0} x {1} -o{2} -y'.format(agent.sevenZipPath, file, target);
                var zipper = exec(cmd, opts, function(err, stdout, stderr) {
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
                var zipper = exec('/Applications/Keka.app/Contents/Resources/keka7z x {0} -o{1} -y'.format(file, target), opts, function(err, stdout, stderr) {
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
                extrator.on('error', function(err) {
                    if (err) {
                        return agent.buildFailed(build, 'Error unzipping {2}:\nTarget:{3}\nErr:{4}', file, target, err);
                    } else {
                        return agent.buildFailed(build, 'Error unzipping {2}:\nTarget:{3}\nError is not available!', file, target);
                    }
                });
                extrator.on('close', function() {
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
    genericBuild: function(build, filesDone, done, onExecutingCordovaBuild, command) {
        command = command || "cordova build {0} {1} --{2}";
        var agent = this;
        var locationPath = build.locationPath;
        var files = build.files;

        function buildFailed(args) {
            splice.call(arguments, 0, 0, build);
            return agent.buildFailed.apply(agent, arguments);
        }

        return agent.conf.reuseworkfolder ? agent.ensureWorkFolder(s3WriteFiles) : s1Cleanup();

        function s1Cleanup() {
            if (build.conf.status === 'cancelled') {
                return;
            }
            serverUtils.cleanLastFolders(agent.conf.keep, agent.workFolder + '/*', s1CleanupDone);
        }
        function s1CleanupDone(err) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            err && agent.log(build, Msg.debug, 'Error while cleaning up last {2} folders in AGENT {3} working folder {4}:\n{5}', agent.conf.keep, agent.conf.platform, agent.workFolder, err);
            agent.ensureWorkFolder(s2EmptyWorkFolder);
        }

        function s2EmptyWorkFolder(err) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                return buildFailed(build, 'error creating the working folder {2}\n{3}', agent.workFolder, err);
            }
            var glob = locationPath;
            if (!/(\/|\\)$/.test(glob)) {
                glob += '/';
            }
            glob += '*';
            multiGlob.glob(glob, function(err, files) {
                if (err) {
                    return s3WriteFiles(null);
                }
                async.each(files, function(file, cb) {
                    fs.remove(file, function(err) {
                        cb(err);
                    });
                }, s3WriteFiles);
            });
        }

        function s3WriteFiles(err) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                return buildFailed('error cleaning the working folder {2}\n{3}', agent.workFolder, err);
            }
            files.forEach(function(file) {
                file.file = path.resolve(locationPath, path.basename(file.file));
            });
            serverUtils.writeFiles(locationPath, files, 'the cordova build agent worker on {0}'.format(build.conf.platform), s4ProcessFiles);
        }

        function s4ProcessFiles(err) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            serverUtils.freeMemFiles(files);
            if (err) {
                return buildFailed('error while saving files on agent worker:\n{2}', err);
            }
            agent.log(build, Msg.info, 'extracting archives for {2}...', build.conf.platform);

            async.each(files, s5ExtractFile, s6AllFilesExtracted);
        }

        function s5ExtractFile(item, cb) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            agent.log(build, Msg.debug, 'extracting {2} to {3}', item.file, locationPath);
            agent.extractArchive(build, item.file, locationPath, {
                cwd: locationPath,
                maxBuffer: maxBuffer
            }, cb);
        }

        function s6AllFilesExtracted(err) {
            // Final callback after each item has been iterated over.
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                return buildFailed('error extracting archive files\n{2}', err);
            }
            if (filesDone) {
                filesDone.call(agent, s6ModifyConfigXML);
            } else {
                s6ModifyConfigXML();
            }
        }
        function s6ModifyConfigXML(cmd) {
            command = cmd || command;
            if (build.conf.status === 'cancelled') {
                return;
            }
            var bundleid = build.conf[build.conf.platform + 'bundleid'] || build.conf.bundleid;
            if (bundleid) {
                var configPath = path.resolve(build.locationPath, 'config.xml');
                agent.log(build, Msg.info, 'Changing bundleid to {2} in config.xml', bundleid);
                fs.readFile(configPath, 'utf8', function(err, data) {
                    if (err) {
                        return buildFailed('error reading {2}\n{3}', configPath, err);
                    }
                    var result = data.replace(/\<widget id\=(\"|\').*?(\"|\')/g, "<widget id=\"{0}\"".format(bundleid));

                    fs.writeFile(configPath, result, 'utf8', function(err) {
                        if (err) {
                            return buildFailed('error writing bundleid {2} into {3}\n{4}', bundleid, configPath, err);
                        }
                        s6DeleteHooks();
                    });
                });
            } else {
                s6DeleteHooks();
            }
        }
        function s6DeleteHooks() {
            var hooks = 'hooks/**/*.bat';
            multiGlob.glob(hooks, {cwd: agent.workFolder}, function(err, hooks) {
                hooks.forEach(function(file) {
                    file = path.resolve(agent.workFolder, file);
                    try {
                        fs.removeSync(file);
                    } catch (e) {
                        agent.buildFailed(this.build, e);
                    }
                });
            });
            s6DecideExecuteCordovaBuild();
        }
        function s6DecideExecuteCordovaBuild() {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (onExecutingCordovaBuild) {
                onExecutingCordovaBuild.call(agent, build, function(err, executeStandardCordovaBuild, args) {
                    executeStandardCordovaBuild !== false && s7BuildCordova(err, args);
                }, s8BuildExecuted, buildFailed);
            } else {
                s7BuildCordova();
            }
        }

        function s7BuildCordova(err, args) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                return buildFailed('error starting build\n{2}', err);
            }
            agent.log(build, Msg.info, 'building cordova on {2}...', build.conf.platform);

            var cmd = command.format(build.conf.platform, args || '', build.conf.buildmode || 'release');

            //@TODO: put to iOS.js
            if (build.conf.platform == 'ios') {
                cmd += ' | tee "' + path.resolve(locationPath, 'build.ios.xcodebuild.log') + '" | egrep -A 5 -i "(error|warning|succeeded|fail|codesign|running|return)"';
            }

            //@TOODO: put to Android.js
            if (build.conf.platform == 'android') {
                if (os.platform() === 'linux') {
                    cmd += ' | tee "build.android.log" | egrep -i -A 6 "(error|warning|success|sign)"';

                    // Set cordova build permission
                    var cb_file = path.resolve(locationPath, 'platforms/android/cordova/build');
                    if (fs.existsSync(cb_file)) {
                        console.log(cb_file + ' has been found! Trying to set chmod...');
                        fs.chmodSync(cb_file, '755', function(err) {
                            err && console.log('Permission for ' + cb_file + ' could not be set!');
                        });
                    } else {
                        console.log(cb_file + ' doesn\'t exist :(\n\n\n');
                    }
                } else {
                    cmd += ' | "' + tee + '" "build.android.log" | "' + egrep + '" -i -A 6 "(error|warning|success|sign)"';
                }
            }

            agent.log(build, Msg.status, 'Executing {2}', cmd);


            //@TODO: error-handling (=> build = failed) when command returns error (e.g. missing android sdk target,...)
            //return buildFailed('error...\n{2}', err);

            var cordova_build = exec(cmd, {
                cwd: locationPath,
                maxBuffer: maxBuffer
            }, s8BuildExecuted);
            cordova_build.on('close', function(code) {
                if (build.conf.status === 'cancelled') {
                    return;
                }
                if (code && code != 1) {
                    return buildFailed('child process exited with code ' + code);
                }
            });
            cordova_build.stdout.on('data', function(data) {
                if (data) {//get rid of new lines at the end
                    data = data.replace(/\r?\n?$/m, '');
                }
                agent.log(build, Msg.build_output, data);
            });
            cordova_build.stderr.on('data', function(data) {
                if (data) {//get rid of new lines at the end
                    data = data.replace(/\r?\n?$/m, '');
                }
                if (data.indexOf('BUILD FAILED') > -1) {
                    return buildFailed(data);
                }
                agent.log(build, Msg.error, data);
            });
        }

        function s8BuildExecuted(err, stdout, stderr) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (stdout) {
                agent.log(build, Msg.build_output, stdout);
            }
            var e;
            if (err && (!err.code || err.code != 1)) {
                e = 1;
                agent.log(build, Msg.error, 'error:\n{2}', err);
            }
            if (stderr) {
                ((err && err.message || err && err.indexOf && err || '').indexOf(stderr) < 0) && agent.log(build, Msg.error, 'stderror:\n{2}', stderr);
            }
            if (e) {
                return agent.buildFailed(build);
            }

            done.call(agent, e);
        }
    },
    computeLocationFolder: function(build) {
        var agent = this;
        build.locationPath = agent.conf.reuseworkfolder ? path.resolve(agent.workFolder) : path.resolve(agent.workFolder, build.Id());
    },
    exec: function(build, cmd, opts, callback, exitCodeError) {
        var agent = this;
        var process = exec(cmd, function(err, stdout, stderr) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            stdout && agent.log(build, Msg.build_output, '{2}', stdout);
            err && (!err.code || err.code != 1) && agent.log(build, Msg.error, 'error:\n{2}', err);
            stderr && (err && err.message || '').indexOf(stderr) < 0 && agent.log(build, Msg.error, 'stderror:\n{2}', stderr);
            callback.apply(agent, arguments);
            if (stderr || err && (!err.code || err.code != 1)) {
                return agent.buildFailed(build, '');
            }
        }).on('close', function(code) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (code && code != 1) {
                return agent.buildFailed(build, exitCodeError || 'process exited with error code {2}', code);
            }
        });
        process.stdout.on('data', function(data) {
            if (/error\:/gi.test(data || ''))
                return agent.buildFailed(build, data);
            agent.log(build, Msg.build_output, data);
        });
        process.stderr.on('data', function(data) {
            agent.log(build, Msg.error, data);
        });
        return process;
    },
    buildSuccess: function(build, globFiles) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        var agent = this;
        var workFolder = build.locationPath;
        multiGlob.glob(globFiles, {
            cwd: workFolder
        }, function(err, files) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                return agent.buildFailed(build, 'error globbing {2}', globFiles);
            }
            files = files.map(function(file) {
                return {file: path.resolve(workFolder, file)};
            });
            agent.emit('uploading', build.id);//change build status to uploading..
            serverUtils.readFiles(files, '[Agent WORKER] cordova build agent worker output files', function(err) {
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
                outputFiles.forEach(function(file) {
                    size += file && file.content && file.content.data && file.content.data.length || 0;
                });
                size && agent.log(build, Msg.info, 'Uploading results file(s) to cordova build server...{0}'.format(fileSize(size)));
                var paths = [];
                outputFiles.forEach(function(file) {
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
                outputFiles.forEach(function(file, index) {
                    file.file = paths[index];
                });
            } finally {
                //free agent's memory of output files contents
                serverUtils.freeMemFiles(outputFiles);
                var buildPath = path.resolve(build.locationPath, 'build.' + build.conf.platform + '.json');
                build.save(buildPath, function(err, e, bp, json) {
                    err && agent.log(build, Msg.debug, err);
                });
            }
        }
    },
    buildFailed: function(build, err, args) {
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
        build.save(buildPath, function(err, e, bp, json) {
            err && agent.log(build, Msg.debug, err);
        });
        this.emit('build-failed', build.serialize());
    }
});
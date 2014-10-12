/**
 * @name GenericBuild
 * @version 0.1
 * @fileoverview handles the build process for all platforms
 */

var $ = require('stringformat');
var os = require('os');
var async = require('async');
var multiGlob = require('multi-glob');
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

/**
 * Constructor of the generic build sequence
 *
 * @class
 * @param {Build} build - reference to the build object
 * @param {Agent} agent - reference to the agent
 * @param {function} filesDone - hook: after file extraction
 * @param {function} done - hook: build finished
 * @param {function} onExecutingCordovaBuild - hook: before executing cordova build
 * @param {String} [command] - command to build
 */
function GenericBuild(build, agent, filesDone, done, onExecutingCordovaBuild, command) {
    this.build = build;
    this.agent = agent;
    this.filesDone = filesDone;
    this.done = done;
    this.onExecutingCordovaBuild = onExecutingCordovaBuild;
    this.command = command || "cordova build {0} {1} --{2}";
    this.locationPath = build.locationPath;
    this.files = build.files;

    return this.agent.conf.reuseworkfolder ? this.agent.ensureWorkFolder(this.s3WriteFiles.bind(this)) : this.s1Cleanup();
}

/**
 * Report failed build to agent
 */
GenericBuild.prototype.buildFailed = function () {
    splice.call(arguments, 0, 0, this.build);
    return this.agent.buildFailed.apply(this.agent, arguments);
};

/**
 * Clean up the agent's workfolder (according to keep argument)
 */
GenericBuild.prototype.s1Cleanup = function () {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    serverUtils.cleanLastFolders(this.agent.conf.keep, this.agent.workFolder + '/*', this.s1CleanupDone.bind(this));
};

/**
 * Ensure the workfolder (create if not exist) after cleaning up
 *
 * @param {Object} [err] - error object (cleanup failed) or null
 */
GenericBuild.prototype.s1CleanupDone = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    var _agent = this.agent;
    if (err) {
        var _msg = 'Error while cleaning up last {2} folders in AGENT {3} working folder {4}:\n{5}';
        _agent.log(this.build, Msg.debug, _msg, _agent.conf.keep, _agent.conf.platform, _agent.workFolder, err);
    }
    _agent.ensureWorkFolder(this.s2EmptyWorkFolder.bind(this));
};

/**
 * Empty the workfolder
 *
 * @param {Object} [err] - error object or null
 */
GenericBuild.prototype.s2EmptyWorkFolder = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        var _msg = 'error creating the working folder {2}\n{3}';
        return this.buildFailed(this.build, _msg, this.agent.workFolder, err);
    }
    var glob = this.locationPath;
    if (!/(\/|\\)$/.test(glob)) {
        glob += '/';
    }
    glob += '*';
    multiGlob.glob(glob, function (err, files) {
        if (err) {
            return this.s3WriteFiles(null);
        }
        async.each(files, function (file, cb) {
            fs.remove(file, function (err) {
                cb(err);
            });
        }, this.s3WriteFiles.bind(this));
    }.bind(this));
};

/**
 * Write files to locationPath
 *
 * @param {Object} [err] - error object (cleaning up failed) or null
 */
GenericBuild.prototype.s3WriteFiles = function (err) {
    var _msg;
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        _msg = 'error cleaning the working folder {2}\n{3}';
        return this.buildFailed(_msg, this.agent.workFolder, err);
    }

    _msg = 'the agentworker on {0}'.format(this.build.conf.platform);
    serverUtils.writeFiles(this.locationPath, this.files, _msg, this.s4ProcessFiles.bind(this));
};

/**
 * Process the files (initiate extraction)
 *
 * @param {Object} [err] - error object (writing files failed) or null
 */
GenericBuild.prototype.s4ProcessFiles = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    //serverUtils.freeMemFiles(this.files);
    if (err) {
        return this.buildFailed('error while saving files on agent worker:\n{2}', err);
    }

    var _msg = 'extracting archives for {2}...';
    this.agent.log(this.build, Msg.info, _msg, this.build.conf.platform);

    async.each(this.files, this.s5ExtractFile.bind(this), this.s6AllFilesExtracted.bind(this));
};

/**
 * Extract the files
 *
 * @param {String} item - file object
 * @param {function} cb - callback
 */
GenericBuild.prototype.s5ExtractFile = function (item, cb) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }

    var _msg = 'extracting {2} to {3}';
    this.agent.log(this.build, Msg.debug, _msg, item.file, this.locationPath);

    this.agent.extractArchive(this.build, item.file, this.locationPath, {
        cwd: this.locationPath,
        maxBuffer: maxBuffer
    }, cb.bind(this));
};

/**
 * Call hook or initiate config modifications after extraction
 *
 * @param {Object} [err] - error object (extraction failed) or null
 */
GenericBuild.prototype.s6AllFilesExtracted = function (err) {
    // Final callback after each item has been iterated over.
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        return this.buildFailed('error extracting archive files\n{2}', err);
    }
    if (this.filesDone) {
        this.filesDone.call(this.agent, this.s6ModifyConfigXML.bind(this));
    } else {
        this.s6ModifyConfigXML();
    }
};

/**
 * Modify the config.xml (set bundleid)
 *
 * @TODO: document bundleid
 *
 * @param {String} [cmd] - cordova command (can be set by filesDone-Hook)
 */
GenericBuild.prototype.s6ModifyConfigXML = function (cmd) {
    this.command = cmd || this.command;
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    var bundleid = this.build.conf[this.build.conf.platform + 'bundleid'] || this.build.conf.bundleid;
    if (bundleid) {
        var configPath = path.resolve(this.build.locationPath, 'config.xml');
        var _msg = 'Changing bundleid to {2} in config.xml';
        this.agent.log(this.build, Msg.info, _msg, bundleid);

        fs.readFile(configPath, 'utf8', function (err, data) {
            if (err) {
                return this.buildFailed('error reading {2}\n{3}', configPath, err);
            }
            var result = data.replace(/<widget id\=(\"|\').*?(\"|\')/g, "<widget id=\"{0}\"".format(bundleid));

            fs.writeFile(configPath, result, 'utf8', function (err) {
                if (err) {
                    var _msg = 'error writing bundleid {2} into {3}\n{4}';
                    return this.buildFailed(_msg, bundleid, configPath, err);
                }
                this.s6DeleteHooks();
            }.bind(this));
        }.bind(this));
    } else {
        this.s6DeleteHooks();
    }
};

/**
 * Delete all cordova hook files
 */
GenericBuild.prototype.s6DeleteHooks = function () {
    var hooks = 'hooks/**/*.bat';
    multiGlob.glob(hooks, {cwd: this.agent.workFolder}, function (err, hooks) {
        hooks.forEach(function (file) {
            file = path.resolve(this.agent.workFolder, file);
            try {
                fs.removeSync(file);
            } catch (e) {
                this.agent.buildFailed(this.build, e);
            }
        }.bind(this));
    }.bind(this));
    this.s6DecideExecuteCordovaBuild();
};

/**
 * Call onExecutingCordovaBuild Hook
 */
GenericBuild.prototype.s6DecideExecuteCordovaBuild = function () {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (this.onExecutingCordovaBuild) {
        this.onExecutingCordovaBuild.call(this.agent, this.build, function (err, executeStandardCordovaBuild, args) {
            if (executeStandardCordovaBuild !== false) {
                this.s7BuildCordova(err, args);
            }
        }.bind(this), this.s8BuildExecuted.bind(this), this.buildFailed.bind(this));
    } else {
        this.s7BuildCordova();
    }
};

/**
 * Run cordova build
 *
 * @TODO: docs
 *
 * @param {type} err
 * @param {type} args
 */
GenericBuild.prototype.s7BuildCordova = function (err, args) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        return this.buildFailed('error starting build\n{2}', err);
    }
    var _msg = 'building cordova on {2}...';
    this.agent.log(this.build, Msg.info, _msg, this.build.conf.platform);

    var cmd = this.command.format(this.build.conf.platform, args || '', this.build.conf.buildmode || 'release');

    //@TODO: put to iOS.js
    if (this.build.conf.platform === 'ios') {
        cmd += ' | tee "' + path.resolve(this.locationPath, 'build.ios.xcodebuild.log') + '" | egrep -A 5 -i "(error|warning|succeeded|fail|codesign|running|return)"';
    }

    //@TOODO: put to Android.js
    if (this.build.conf.platform === 'android') {
        if (os.platform() === 'linux') {
            cmd += ' | tee "build.android.log" | egrep -i -A 6 "(error|warning|success|sign)"';

            // Set cordova build permission
            var cb_file = path.resolve(this.locationPath, 'platforms/android/cordova/build');

            //@TODO: async?
            if (fs.existsSync(cb_file)) {
                fs.chmodSync(cb_file, '755', function (err) {
                    if (err) {
                        var _msg = 'Permission for {2} could not be set!';
                        this.agent.log(this.build, Msg.info, _msg, cb_file);
                    }
                }.bind(this));
            }
        } else {
            cmd += ' | "' + tee + '" "build.android.log" | "' + egrep + '" -i -A 6 "(error|warning|success|sign)"';
        }
    }

    this.agent.log(this.build, Msg.status, 'Executing {2}', cmd);


    //@TODO: error-handling (=> build = failed) when command returns error (e.g. missing android sdk target,...)
    //return buildFailed('error...\n{2}', err);

    var cordova_build = exec(cmd, {
        cwd: this.locationPath,
        maxBuffer: maxBuffer
    }, this.s8BuildExecuted.bind(this));

    cordova_build.on('close', function (code) {
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        if (code && code !== 1) {
            return this.buildFailed('child process exited with code ' + code);
        }
    }.bind(this));

    cordova_build.stdout.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        this.agent.log(this.build, Msg.build_output, data);
    }.bind(this));

    cordova_build.stderr.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        if (data.indexOf('BUILD FAILED') > -1) {
            return this.buildFailed(data);
        }
        this.agent.log(this.build, Msg.error, data);
    }.bind(this));
};

/**
 * build executed
 * @TODO: Docs
 *
 * @param {type} err
 * @param {type} stdout
 * @param {type} stderr
 * @returns {undefined|GenericBuild.agent.buildFailed}
 */
GenericBuild.prototype.s8BuildExecuted = function (err, stdout, stderr) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (stdout) {
        this.agent.log(this.build, Msg.build_output, stdout);
    }

    var e;
    if (err && (!err.code || err.code !== 1)) {
        e = 1;
        this.agent.log(this.build, Msg.error, 'error:\n{2}', err);
    }
    if (stderr) {
        if ((err && err.message || err && err.indexOf && err || '').indexOf(stderr) < 0) {
            this.agent.log(this.build, Msg.error, 'stderror:\n{2}', stderr);
        }
    }
    if (e) {
        return this.agent.buildFailed(this.build);
    }

    this.done.call(this.agent, e);
};
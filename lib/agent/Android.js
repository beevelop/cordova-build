/**
 * @name Android
 * @version 0.1
 * @fileoverview contains Android's specific build processes
 *                 mainly hooks into {@link GenericBuild}'s callbacks
 */

var $ = require('stringformat');
var async = require('async');
var multiGlob = require('multi-glob');
var whereis = require('whereis');
var fs = require('fs-extra');
var path = require('path');
var Msg = require('../common/Msg.js');
var GenericBuild = require('./GenericBuild');
var maxBuffer = 524288;
var tee = path.resolve(__dirname, '../../bin/tee.exe');
var egrep = path.resolve(__dirname, '../../bin/egrep.exe');


/**
 * Constructor of the android build sequence
 *
 * @class
 * @param {Build} build - reference to the build object
 * @param {Agent} agent - reference to the agent
 */
function Android(build, agent) {
    this.build = build;
    this.agent = agent;
    this.workFolder = build.locationPath;
    this.androidFolder = path.resolve(this.workFolder, 'platforms/android');
    this.assetsFolder = path.resolve(this.androidFolder, 'assets/www');
    this.signLogPath = path.resolve(this.workFolder, 'build.android.sign.jarsign.log');
    this.alignLogPath = path.resolve(this.workFolder, 'build.android.zipalign.log');
    this.apkGlobPath = ['platforms/android/**/*.apk'];
    //this.updateAssetsWWW = false;
    this.localProps = null;
}

/**
 * Initiate building sequence
 * looks for existing APKs
 */
Android.prototype.init = function () {
    multiGlob.glob(this.apkGlobPath, {
        cwd: this.workFolder
    }, this.deleteAPKs.bind(this));
};


/**
 * Delete the found APKs
 *
 * @param {Object} [err] - error object (globbing failed) or null
 * @param {Array}  files - array of found APK filenames
 */
Android.prototype.deleteAPKs = function (err, files) {
    if (files.length) {
        this.agent.log(this.build, Msg.info, "Deleting existing apks:\n{2}", files.join('\n'));
    }
    async.each(files, function (file, callback) {
        file = path.resolve(this.workFolder, file);
        fs.unlink(file, callback);
    }.bind(this), this.startBuild.bind(this));
};

/**
 * Initiate the Agent's generic Build if everthing went right
 *
 * @param {Object} [err] - error object (looping asynchronously through APKS failed) or null
 */
Android.prototype.startBuild = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        this.agent.log(this.build, Msg.info, "Error while deleting existing apks, {2}", err);
    }

    var _genericBuild = new GenericBuild(this.build, this.agent);
    _genericBuild.setHook('filesDone', this.filesDone.bind(this));
    _genericBuild.setHook('buildDone', this.buildDone.bind(this));
    _genericBuild.launch();
};


/**
 * Hook into filesDone to make some file manipulations
 *
 * @param {function} startBuild - the Agent's callback to start the build
 */
Android.prototype.filesDone = function (startBuild) {
    this.agent.callback = startBuild;
    this.localProps = path.resolve(this.androidFolder, 'local.properties');

    var _androidHomeExists = process.env.ANDROID_HOME && process.env.ANDROID_HOME.length > 0 && fs.existsSync(process.env.ANDROID_HOME);
    if (fs.existsSync(this.localProps) && _androidHomeExists) {
        fs.deleteSync(this.localProps); // remove local.properties if ANDROID_HOME is set
        this.ensureAssetsFolder.apply(this);
    } else {
        // search for android executable
        if (this.agent.conf.androidsdk) {
            this.writeLocalProperties(null, this.agent.conf.androidsdk);
        } else {
            whereis('android', this.writeLocalProperties.bind(this));
        }
    }

    // @TODO: rework?
    //@TODO: remove bind this
    /*this.agent.log(this.build, Msg.info, "Searching for existing apks for a faster build");
     var cordovaLibPath = path.resolve(this.androidFolder, 'CordovaLib');
     fs.exists(cordovaLibPath, function(cordovaLibPathExists) {
     if (!cordovaLibPathExists && this.build.conf.androidreleaseapk) {
     var source = this.build.conf[this.build.conf.buildmode === 'release' ? 'androidreleaseapk' : 'androiddebugapk'];
     var dest = path.resolve(this.androidFolder, path.basename(source));
     fs.copy(source, dest, function(err) {
     if (this.build.conf.status === 'cancelled') {
     return;
     }
     if (err) {
     return this.agent.buildFailed(this.build, 'Error copying apk {2} to {3}\n{4}', source, dest, err);
     }
     this.apkGlobPath = [dest];
     this.updateAssetsWWW = true;
     this.agent.log(this.build, Msg.info, "Apk found {2}. Updating only assets/www for a faster build", this.apkGlobPath[0]);
     this.ensureAssetsFolder.call(this, "cordova prepare {0} {1}");
     });
     } else {
     this.ensureAssetsFolder.call(this);
     }
     }.bind(this));*/
};

/**
 * Replace local properties with system sdk.dir
 *
 * @param {Object} [err]        - error object (searching android failed) or null
 * @param {String} androidFile - the path to the android executable
 */
Android.prototype.writeLocalProperties = function (err, androidFile) {
    if (err) {
        var _msg = 'Error: Android executable could not be found! Please set ANDROID_HOME environment variable.\n{2}';
        return this.agent.buildFailed(this.build, _msg, err);
    }

    var sdkDir = path.resolve(androidFile, '..', '..').replace(/\\/g, '\\\\');
    try {
        fs.writeFileSync(this.localProps, 'sdk.dir=' + sdkDir);
        this.ensureAssetsFolder.apply(this);
    } catch (e) {
        this.agent.log(this.build, Msg.error, 'Error: Can\'t replace local.properties at {2}', sdkDir);
        if (e) {
            this.agent.log(this.build, Msg.error, e);
        }
    }
};

/**
 * Ensure assets folder exists (if necessary creates it)
 *
 * @param {String} [command] - optional command, gets passed to {@link GenericBuild#s6ModifyConfigXML}
 */
Android.prototype.ensureAssetsFolder = function (command) {
    this.agent.log(this.build, Msg.info, "Ensuring android work folder {2}", this.assetsFolder);
    fs.mkdirs(this.assetsFolder, this.runCordovaBuild.bind(this.agent, command));
};

/**
 * End file manipulation and run cordova build
 *
 * @this GenericBuild
 * @param {String} [command] - optional command, gets passed to {@link GenericBuild#s6ModifyConfigXML}
 * @param {Object} [err]     - error object (ensuring assets folder failed) or null
 * @see {@link Android#ensureAssetsFolder}
 */
Android.prototype.runCordovaBuild = function (command, err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        return this.agent.buildFailed(this.build, 'Error ensuring assets/www folder: {2}', err);
    }

    //has agent scope (so basically this.agent.callback)
    this.callback(command);
};

/**
 * Hook into the {@link GenericBuild}s buildDone callback
 *
 * @param {Object} [err] - error object or null
 */
Android.prototype.buildDone = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }

    this.sign();

    //@TODO: depends on line 123
    //@TODO: remove bind this
    /*if (this.updateAssetsWWW) {
     this.agent.modifyArchive(this.build, 'd', this.apkGlobPath[0], 'assets', {
     cwd: this.androidFolder,
     maxBuffer: maxBuffer
     }, function () {
     this.agent.modifyArchive(this.build, 'a', this.apkGlobPath[0], 'assets', {
     cwd: this.androidFolder,
     maxBuffer: maxBuffer
     }, this.sign);
     }.bind(this));
     } else {
     this.sign();
     }*/
};

/**
 * Initiates the signing process
 */
Android.prototype.sign = function () {
    if (this.build.conf.androidsign) {
        multiGlob.glob(this.apkGlobPath, {
            cwd: this.workFolder
        }, function (err, apks) {
            //we should sign unaligned apks
            apks = apks.filter(function (apk, i) {
                return !i;
            });
            this.apkGlobPath = apks;
            this.agent.archiver.modifyArchive.call(this.agent.archiver, this.build, 'd', apks[0], 'META-INF', {
                cwd: this.workFolder,
                maxBuffer: maxBuffer
            }, this.jarSigner);
        }.bind(this));
    } else {
        this.done();
    }
};

/**
 * Sign the generated APKs
 */
Android.prototype.jarSigner = function () {
    var apks = this.apksGlobPath;
    var androidsign = this.build.conf.androidsign;
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    this.agent.log(this.build, Msg.debug, 'APK Files:\n{2}', apks.join('\n'));
    var _self = this;
    apks = apks.map(function (apk) {
        return path.resolve(_self.workFolder, apk);
    });
    androidsign = androidsign.format.apply(androidsign, apks) + ' 2>&1 | "{0}" "{1}" | "{2}" -i -E -v "(tsacert|signing|warning|adding)"'.format(tee, this.signLogPath, egrep);
    this.agent.log(this.build, Msg.status, androidsign);

    this.agent.exec(this.build, androidsign, {
        maxBuffer: maxBuffer
    }, function (err, stdout, stderr) {
        if (err || stderr) {
            return;
        }
        this.zipAlign(apks[0]);
    }.bind(this), 'android sign process exited with code {2}');
};

/**
 * zipalign the APKs to reduce RAM consumption when running the application
 *
 * @param {String} apk - apk file
 * @see [zipalign | Android Developers]{@link https://developer.android.com/tools/help/zipalign.html}
 */
Android.prototype.zipAlign = function (apk) {
    var output = apk.replace('-unsigned', '').replace('-unaligned', '');
    var key = this.build.conf.androidsign.match(/(.*)(\\|\/| )(.*)(\.keystore)/i);
    key = key && key[3];
    key = key && ("-" + key);
    output = path.resolve(path.dirname(apk), path.basename(output, '.apk') + key + '-signed-aligend.apk');
    if (apk === output) {
        output = output.replace('.apk', '-updated.apk');
    }
    var zipalign = 'zipalign -f -v 4  "{0}" "{1}"'.format(apk, output);
    zipalign = zipalign + ' 2>&1 | "{0}" "{1}" | "{2}" -i -A 5 "(success)""'.format(tee, this.alignLogPath, egrep);

    var _self = this;
    this.agent.exec(this.build, zipalign, {
        cwd: this.workFolder,
        maxBuffer: maxBuffer
    }, function (err, stdout, stderr) {
        if (err && (!err.code || err.code !== 1) || stdout || _self.build.conf.status === 'cancelled') {
            return;
        }
        _self.apkGlobPath = [output];
        _self.done();
    }, 'android zipalign process exited with code {2}');
};

/**
 * Hook into the {@link GenericBuild}s done callback
 *
 * @param {Object} [err] - error object (build failed) or null
 */
Android.prototype.done = function (err) {
    if (!err) {
        this.agent.buildSuccess(this.build, this.apkGlobPath.concat(['build.android.log', this.signLogPath, this.alignLogPath]));
    }
};

module.exports = Android;
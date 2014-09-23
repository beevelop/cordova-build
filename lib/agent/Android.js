module.exports = Android;

var $ = require('stringformat'),
        os = require('os'),
        async = require('async'),
        multiGlob = require('multi-glob'),
        whereis = require('whereis'),
        fs = require('fs-extra'),
        path = require('path'),
        exec = require('child_process').exec,
        Msg = require('../common/Msg.js'),
        maxBuffer = 524288,
        tee = path.resolve(__dirname, '../../bin/tee.exe'),
        egrep = path.resolve(__dirname, '../../bin/egrep.exe');

function Android(build, agent) {
    this.build = build;
    this.agent = agent;
    this.workFolder = build.locationPath;
    this.androidFolder = path.resolve(this.workFolder, 'platforms/android');
    this.assetsFolder = path.resolve(this.androidFolder, 'assets/www');
    this.signLogPath = path.resolve(this.workFolder, 'build.android.sign.jarsign.log');
    this.alignLogPath = path.resolve(this.workFolder, 'build.android.zipalign.log');
    this.apkGlobPath = ['platforms/android/**/*.apk'];
    this.updateAssetsWWW = false;
    this.local_props = null;
}

Android.define({
    /* 0.) Initiate building sequence */
    init: function() {
        multiGlob.glob(this.apkGlobPath, {
            cwd: this.workFolder
        }, this.deleteAPKs.bind(this));
    },
    /* 1.) Delete existing APKs */
    deleteAPKs: function(err, files) {
        if (files.length) {
            this.agent.log(this.build, Msg.info, "Deleting existing apks:\n{2}", files.join('\n'));
        }
        async.each(files, function(file, callback) {
            this.agent.log(this.build, Msg.info, file);
            file = path.resolve(this.workFolder, file);
            fs.unlink(file, callback);
        }.bind(this), this.startBuild.bind(this));
    },
    /* 2.) Initiate generic Build */
    startBuild: function(err) {
        this.agent.log(this.build, Msg.info, "Start Build....");
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        if (err) {
            this.agent.log(this.build, Msg.info, "Error while deleting existing apks, {2}", err);
        }
        this.agent.log(this.build, Msg.info, "Starting Android Build => GenericBuild");
        this.agent.genericBuild(this.build, this.filesDone.bind(this), this.buildDone.bind(this), null);
    },
    /* 3.) Hook into filesDone to make some file manipulations */
    filesDone: function(startBuild) {

        this.agent.callback = startBuild;
        this.local_props = path.resolve(this.androidFolder, 'local.properties');
        if (fs.existsSync(this.local_props) && (process.env.ANDROID_HOME && process.env.ANDROID_HOME.length > 0 && fs.existsSync(process.env.ANDROID_HOME))) {
            fs.deleteSync(this.local_props); // remove local.properties if ANDROID_HOME is set
        } else {
            // search for android executable
            whereis('android', this.writeLocalProperties.bind(this));
        }

        this.agent.log(this.build, Msg.info, "Searching for existing apks for a faster build");
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
                    this.ensureAssetsFolder.apply(this, "cordova prepare {0} {1}");
                });
            } else {
                this.ensureAssetsFolder.apply(this);
            }
        }.bind(this));
    },
    /* 3.1) Replace local properties with system sdk.dir */
    writeLocalProperties: function(err, android_file) {
        if (err) {
            return this.agent.buildFailed(this.build, 'Error: Android executable could not be found! Please set ANDROID_HOME environment variable.\n{2}', err);
        }
        this.agent.log(this.build, Msg.info, 'Yeah: android executable has been found at {2}', android_file);

        var sdk_dir = path.resolve(android_file, '..', '..').replace(/\\/g, '\\\\');
        try {
            fs.writeFileSync(this.local_props, 'sdk.dir=' + sdk_dir);
        } catch (e) {
            this.agent.log(this.build, Msg.error, 'Error: Can\'t replace local.properties at {2}', sdk_dir);
            if (e) {
                this.agent.log(this.build, Msg.error, e);
            }
        }
    },
    /* 4.) Ensure assets folder */
    ensureAssetsFolder: function(command) {
        this.agent.log(this.build, Msg.info, "Ensuring android work folder {2}", this.assetsFolder);
        fs.mkdirs(this.assetsFolder, this.runCordovaBuild.bind(this.agent, command));
    },
    /* 5.) run Cordova Build */
    runCordovaBuild: function(command, err) {
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        if (err) {
            return this.agent.buildFailed(this.build, 'Error ensuring assets/www folder: {2}', err);
        }
        this.callback(command);
    },
    /* 6.) Hook into buildDone */
    buildDone: function(err) {
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        if (this.updateAssetsWWW) {
            this.agent.modifyArchive(this.build, 'd', this.apkGlobPath[0], 'assets', {
                cwd: this.androidFolder,
                maxBuffer: maxBuffer
            }, function() {
                this.agent.modifyArchive(this.build, 'a', this.apkGlobPath[0], 'assets', {
                    cwd: this.androidFolder,
                    maxBuffer: maxBuffer
                }, this.sign);
            }.bind(this));
        } else {
            this.sign();
        }
    },
    /* 7.) Sign APKs */
    sign: function() {
        //build.conf.androidsign = "jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 -keystore d:\\cordova-build\\certificates\\android\\safetybank.live.keystore -storepass Safetybank@14 -keypass Safetybank@14 {0} sftb";
        if (this.build.conf.androidsign) {
            multiGlob.glob(this.apkGlobPath, {
                cwd: this.workFolder
            }, function(err, apks) {
                //we should sign unaligned apks
                apks = apks.filter(function(apk, i) {
                    return !i;
                });
                this.apkGlobPath = apks;
                this.agent.modifyArchive(this.build, 'd', apks[0], 'META-INF', {
                    cwd: this.workFolder,
                    maxBuffer: maxBuffer
                }, this.jarSigner);
            }.bind(this));
        } else {
            this.done();
        }
    },
    jarSigner: function() {
        var apks = this.apksGlobPath;
        var androidsign = this.build.conf.androidsign;
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        this.agent.log(this.build, Msg.debug, 'APK Files:\n{2}', apks.join('\n'));
        apks = apks.map(function(apk) {
            return path.resolve(this.workFolder, apk);
        });
        androidsign = androidsign.format.apply(androidsign, apks) + ' 2>&1 | "{0}" "{1}" | "{2}" -i -E -v "(tsacert|signing|warning|adding)"'.format(tee, this.signLogPath, egrep);
        this.agent.log(this.build, Msg.status, androidsign);

        this.agent.exec(this.build, androidsign, {
            maxBuffer: maxBuffer
        }, function(err, stdout, stderr) {
            if (err || stderr) {
                return;
            }
            this.zipAlign(apks[0]);
        }.bind(this), 'android sign process exited with code {2}');
    },
    zipAlign: function(apk) {
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
        this.agent.exec(this.build, zipalign, {
            cwd: this.workFolder,
            maxBuffer: maxBuffer
        }, function(err, stdout, stderr) {
            if (err && (!err.code || err.code !== 1) || stdout || this.build.conf.status === 'cancelled') {
                return;
            }
            this.apkGlobPath = [output];
            this.done();
        }, 'android zipalign process exited with code {2}');
    },
    /* x.) Success */
    done: function(err) {
        if (!err) {
            this.agent.buildSuccess(this.build, this.apkGlobPath.concat(['build.android.log', this.signLogPath, this.alignLogPath]));
        }
    }
});
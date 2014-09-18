module.exports = iOS;

var $ = require('stringformat'),
        os = require('os'),
        async = require('async'),
        multiGlob = require('multi-glob'),
        fs = require('fs-extra'),
        path = require('path'),
        exec = require('child_process').exec,
        Msg = require('../common/Msg.js'),
        splice = Array.prototype.splice,
        maxBuffer = 524288;


function iOS(build, agent) {
    this.build = build;
    this.agent = agent;
    this.workFolder = build.locationPath;
    this.build_dir = path.resolve(this.workFolder, "platforms/ios/build/device/"); //@TODO: device = variable?
    this.payload_dir = null;
    this.itunesartwork = null;
    this.app_dir = null;
    this.product_name = null;
}

iOS.define({
    buildFailed: function() {
        splice.call(arguments, 0, 0, this.build);
        return this.agent.buildFailed.apply(this.agent, arguments);
    },
    
    /* 0.) Initiate building sequence */
    init: function() {
        this.agent.genericBuild(this.build, this.filesDone.bind(this), this.buildDone.bind(this), this.execCordovaBuild);
    },
    
    /* 1.) Hook into filesDone to do some file manipulation*/
    filesDone: function(startBuild) {
        this.agent.callback = startBuild;
        if (this.build.conf.status === 'cancelled') {
            return;
        }

        /* Replace build.xcconfig to disable Code-Signing */
        if (this.build.conf.iosskipsign) {
            var xcconfig = path.resolve(this.workFolder, 'platforms', 'ios', 'cordova', 'build.xcconfig');
            try {
                fs.writeFileSync(xcconfig, 'CODE_SIGN_IDENTITY=\nCODE_SIGNING_REQUIRED=NO\nPROVISIONING_PROFILE=');
            } catch (e) {
                this.agent.log(this.build, Msg.error, 'Error: Can\'t replace build.xcconfig at {2}', path.resolve(xcconfig, '..'));
                e && this.agent.log(this.build, Msg.error, e);
            }
        }
        this.setPermissions.apply(this);
    },
    
    /* 3.) Set permission of cordova-platform files to 777 (@TODO: necessary?) */
    setPermissions: function() {
        var globs = path.resolve(this.workFolder, 'platforms/ios/cordova/**/*');
        multiGlob.glob(globs, function(err, files) {
            if (err) {
                return this.agent.callback(err);
            }

            async.each(files, function(file, cb) {
                fs.chmod(file, 777, function(err) {
                    cb.defer(0, null, err);
                });
            }, function(err) {
                this.agent.callback.defer(0, agent, err);
            }.bind(this));
        }.bind(this));
    },
    
    /* 4.) Hook into buildDone to sign the app and / or generate the .ipa-file  */
    buildDone: function(err) {
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        if (err) {
            return this.buildFailed.apply(this, err);
        }
        
        multiGlob.glob(['*.app'], {
            cwd: this.build_dir
        }, function(err, files) {
            err && this.agent.log(this.build, Msg.error, "There was an error searching the .app directory:\n{2}", err);
            files.length && this.agent.log(this.build, Msg.info, "Found the following .app-file(s):\n{2}", files.join('\n'));
            this.app_dir = path.resolve(this.build_dir, files[0]);
            this.payload_dir = path.resolve(this.app_dir, "Payload");
            this.itunesartwork = path.resolve(this.app_dir, 'iTunesArtwork');
            this.product_name = path.basename(this.app_dir).replace(/\.[^/.]+$/, '');
            if (fs.existsSync(this.app_dir)) {
                if (this.build.conf.iosskipsign) {
                    this.agent.log(this.build, Msg.info, 'Creating a new unsigned ipa!');
                    this.generateUnsignedIpa.apply(this);
                } else {
                    this.generateSignedIpa.apply(this);
                }
            }
        }.bind(this));
    },
    
    /* 4.) generate signed IPA */
    generateSignedIpa: function () {
        this.agent.log(this.build, Msg.info, 'Creating a new signed ipa!');

        if (!this.build.conf.iosprovisioningpath) {
            return this.buildFailed('-iosprovisioningpath:"path-to-your-provision-file.mobileprovision" was not being specified!');
        }
        if (!this.build.conf.ioscodesignidentity) {
            return this.buildFailed('-ioscodesignidentity:"your-provision-name" was not being specified!');
        }
        var pathOfIpa = path.resolve(this.build_dir, this.product_name + '.ipa');
        var pathOfInfo_plist = path.resolve(this.app_dir, 'Info.plist');
        
        if (!fs.existsSync(this.build.conf.iosprovisioningpath)) {
            return this.buildFailed('-iosprovisioningpath:"{2}" file does not exist!', this.build.conf.iosprovisioningpath);
        }

        var xcodebuildLogPath = path.resolve(this.workFolder, 'build.ios.xcodebuild.log');
        var signLogPath = path.resolve(this.workFolder, 'build.ios.sign.xcrun.log');
        var execPath = '/usr/bin/xcrun -sdk iphoneos PackageApplication -v "{0}" -o "{1}" --sign "{2}" --embed "{3}" | tee "{4}" | egrep -A 5 -i "(return|sign|invalid|error|warning|succeeded|fail|running)"'.format(this.app_dir, pathOfIpa, this.build.conf.ioscodesignidentity, this.build.conf.iosprovisioningpath, signLogPath);

        this.agent.log(this.build, Msg.status, 'executing: {2}', execPath);

        this.agent.exec(this.build, execPath, {maxBuffer: maxBuffer}, function(err, stdout, stderr) {
            if (this.build.conf.status === 'cancelled') {
                return;
            }
            stdout && this.agent.log(this.build, Msg.build_output, '{2}', stdout);
            err && this.agent.log(this.build, Msg.error, 'error:\n{2}', err);
            stderr && (err && err.message || '').indexOf(stderr) < 0 && this.agent.log(this.build, Msg.error, 'stderror:\n{2}', stderr);
            var e = stderr || err;
            if (e) {
                return this.agent.buildFailed(this.build, '');
            }
            this.agent.log(this.build, Msg.status, 'Converting Info.plist as xml: \nplutil -convert xml1 {2}', pathOfInfo_plist);

            this.agent.exec(this.build, 'plutil -convert xml1 ' + pathOfInfo_plist, {maxBuffer: maxBuffer}, function(err, stdout, stderr) {
                if (err || stderr) {
                    return this.agent.buildFailed(this.build, 'plutil erro converting Info.plist as xml: \n{2}\n{3}', err, stderr);
                }
                this.agent.log(this.build, Msg.info, 'Output files: \n{2}\n{3}', pathOfIpa, pathOfInfo_plist);
                this.agent.buildSuccess(this.build, [pathOfIpa, pathOfInfo_plist, signLogPath, xcodebuildLogPath]);
            }.bind(this), 'plutil process exited with code');
        }.bind(this), 'sign process exited with code {2}');
    },
    
    /* 4.2.) generate unsigned IPA */
    generateUnsignedIpa: function() {
        /* 1.) create Payload directory */
        fs.mkdirs(this.payload_dir, function(err) {
            err && this.agent.log(this.build, Msg.error, "Can\'t create Payload directory at {2}:\n{3}", this.build_dir, err);

            /* 2.) copy .app-file recursively into Payload directory */
            this.agent.log(this.build, Msg.info, 'Currently assuming that Product Name is {2}', this.product_name);

            fs.copy(this.app_dir, this.payload_dir, function(err) {
                if (err) {
                    this.agent.log(this.build, Msg.error, "Can\'t copy {2} to {3}:\n{4}", path.basename(this.app_dir), this.payload_dir, err);
                }

                /* 3.) copy iTunesArtwork to Build Directory directory */
                fs.exists(this.itunesartwork, function(exists) {
                    if (exists) {
                        fs.copy(this.itunesartwork, this.build_dir, function(err) {
                            if (err) {
                                this.agent.log(this.build, Msg.error, "Can\'t copy {2} to {3}:\n{4}", this.itunesartwork, this.build_dir, err);
                            }
                        });
                    }

                    /* 4.) zip Payload and iTunesArtwork */
                    exec("/usr/bin/zip -r {0}.ipa Payload iTunesArtwork".format(this.product_name), {
                        cwd: this.build_dir,
                        maxBuffer: maxBuffer
                    }, function(err, stdout, stderr) {
                        if (this.build.conf.status === 'cancelled') {
                            return;
                        }
                        if (stdout) {
                            this.agent.log(build, Msg.build_output, stdout);
                        }
                        var e;
                        if (err && (!err.code || err.code != 1)) {
                            e = 1;
                            this.agent.log(this.build, Msg.error, 'error:\n{2}', err);
                        }
                        if (stderr && (err && err.message || err && err.indexOf && err || '').indexOf(stderr) < 0) {
                            this.agent.log(this.build, Msg.error, 'stderror:\n{2}', stderr);
                        }
                        if (e) {
                            return this.agent.buildFailed(this.build);
                        }

                        /* 5.) Return the files and finish build */
                        var pathOfIpa = path.resolve(this.build_dir, this.product_name + '.ipa'),
                                xcodebuildLogPath = path.resolve(this.workFolder, 'build.ios.xcodebuild.log'),
                                pathOfInfo_plist = path.resolve(this.app_dir, 'Info.plist');

                        return this.agent.buildSuccess(this.build, [pathOfIpa, xcodebuildLogPath, pathOfInfo_plist]);
                    }.bind(this));
                }.bind(this));
            }.bind(this));
        }.bind(this));
    },
    execCordovaBuild: function(build, buildCordova) {
        if (build.conf.iosskipsign) {
            buildCordova(
                    null,
                    true,
                    "--device"
                    );//pass the --device argument only on ios
        } else {
            buildCordova(
                    null,
                    true,
                    "--device{0}{1}".format(
                            build.conf.ioscodesignidentity && " CODE_SIGN_IDENTITY='{0}'".format(build.conf.ioscodesignidentity) || '',
                            build.conf.iosprovisioningpath && " PROVISIONING_PROFILE='{0}'".format(build.conf.iosprovisioningpath) || ''
                            )
                    );//pass the --device argument only on ios
        }
    }
});
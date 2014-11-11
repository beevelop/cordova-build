var path = require('path');
var fs = require('fs-extra');
var async = require('async');
var extend = require('extend');
var multiGlob = require('multi-glob');

function serverUtils() {}

serverUtils.writeFiles = function (folder, files, locationMsg, doNotFreeMem, done) {
    if (typeof doNotFreeMem == 'function') {
        done = doNotFreeMem;
        doNotFreeMem = false;
    }

    fs.mkdirs(folder, function (err) {
        if (err) {
            err = "error creating folder {0} on {1}\n{2}".format(folder, locationMsg, err);
            done(err);
        } else {
            if (files.length) {
                async.each(files, function (file, cb) {
                    var basename = file.file.replace(/\\/g, '/').replace(/.*\//, '');
                    var fileName = path.resolve(folder, basename);
                    file.file = fileName;
                    try {
                        var data = new Buffer(file.content.data, 'base64');
                        if (file.content) {
                            fs.writeFile(fileName, data, {
                                encoding: 'binary'
                            }, function (err) {
                                if (!doNotFreeMem) {
                                    delete file.content; //free server's memory with file's content
                                }
                                cb(err);
                            });
                        } else {
                            cb(null);
                        }
                    } catch (e) {
                        cb(e);
                    }
                }, function (err) {
                    if (err) {
                        err = "error saving cordova build files to {0} on {1}\n{2}".format(folder, locationMsg, err);
                    }
                    done(err);
                });
            } else {
                done(null);
            }
        }
    });
};

serverUtils.freeMemFiles = function (files) {
    files.forEach(function (file) {
        delete file.content;
    });
};

serverUtils.readFiles = function (files, locationMsg, done) {
    if (files.length) {
        async.each(files, function (file, cb) {
            fs.readFile(file.file, {
                //encoding: 'binary',
            }, function (err, data) {
                if (!err) {
                    var buf = new Buffer(data);
                    file.content = {
                        data: buf.toString('base64')
                    };
                    var length = file.content.data.length;
                    global.bu = buf;
                }
                cb(err);
            });
        }, function (err) {
            if (err) {
                err = "error reading build input files on {0}\n{1}".format(locationMsg, err);
            }
            done(err);
        });
    } else {
        done(null);
    }
};

serverUtils.cleanLastFolders = function (keepLast, globsArray, done) {
    if (keepLast <= 0) {
        done();
        return;
    }
    multiGlob.glob(globsArray, function (err, paths) {
        if (err) {
            return done(err);
        }
        if (!paths.length) {
            return done();
        }
        async.map(paths, function (path, cb) {
            fs.stat(path, function (err, filestats) {
                path = {
                    filepath: path,
                    stats: filestats,
                    isDir: filestats.isDirectory()
                };
                cb(err, path);
            });
        }, function(err, sPaths){
            if (err) {
                return done(err);
            }

            // Filter for directories
            sPaths = sPaths.filter(function (sPath) {
                return sPath.isDir;
            });

            // Sort by modify date
            sPaths.sort(function (a, b) {
                return b.stats.mtime - a.stats.mtime;
            });

            sPaths.splice(0, keepLast);

            async.each(sPaths, function (stat, cb) {
                fs.remove(stat.filepath, cb);
            }, function (err) {
                done(err, sPaths);
            });
        });
    });
};

module.exports = serverUtils;
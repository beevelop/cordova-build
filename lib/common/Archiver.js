/**
 * @name Archiver
 * @version 0.1
 * @fileoverview provides extraction and modification functionality for zip archives
 *               uses 7z (on windows and linux), keka (on Mac) or unzip
 */

var unzip = require('unzip');
var fs = require('fs-extra');
var path = require('path');
var exec = require('child_process').exec;
var maxBuffer = 524288;

/**
 * Constructor of Archiver
 * initialises archiver detection
 * @class
 */
function Archiver(path7z) {
    this.sevenZipPath = path7z || "7z";
    this.detectZipArchiver();
}

/**
 * Archiver mode: 7z, 7z64, keka7z, unzip
 * @type {string}
 */
Archiver.prototype.mode = '';

/**
 * Examine which program should be use to modify or extract zip-archives
 */
Archiver.prototype.detectZipArchiver = function () {
    var _self = this;
    exec(_self.sevenZipPath, {maxBuffer: maxBuffer}, function (err) {
        if (!err) {
            _self.mode = '7z';
        } else {
            _self.guessZipArchiver();
        }
    });
};

/**
 * Tries to guess the 7z or keka7z paths
 */
Archiver.prototype.guessZipArchiver = function () {
    this.mode = 'unzip';

    var _path7z, _mode;
    if ((/^win/).test(process.platform)) {
        _path7z = '"C:\\Program Files\\7-Zip\\7z.exe"';
        _mode = '7z64';
    } else if (os.platform() === 'darwin') {
        _path7z = '/Applications/Keka.app/Contents/Resources/keka7z';
        _mode = 'keka7z';
    }

    if (_mode) {
        var _self = this;
        exec(_path7z, {maxBuffer: maxBuffer}, function (err) {
            if (!err) {
                _self.mode = _mode;
                _self.sevenZipPath = _path7z;
            }
        });
    }
};

/**
 * Modify a zip-archive
 *
 * @param {Build} build      - the build object
 * @param {String} modifier  - 7z modifier flag (e.g. a / e / l)
 * @param {String} file      - path to the zip file
 * @param {String} filenames - space separated list of filenames to remove, add,...
 * @param {Object} opts      - additional options for the execution
 * @param {function} done    - callback function
 */
Archiver.prototype.modifyArchive = function (build, modifier, file, filenames, opts, done) {
    var _self = this;
    var verb = modifier === 'a' ? 'adding' : 'removing';
    var into = modifier === 'a' ? 'to' : 'from';
    var errMsg = 'Error {2} {3} {4} archive via {5}\n{6}\n{7}';
    switch (_self.mode) {
        case '7z':
        case '7z64':
        case 'keka7z':
            var _cmd = '{0} {1} -tzip {2} {3}'.format(_self.sevenZipPath, modifier, file, filenames);
            exec(_cmd, opts, function (err, stdout, stderr) {
                if (build.conf.status === 'cancelled') {
                    return;
                }
                if (err) {
                    return _self.buildFailed(build, errMsg, verb, filenames, into, _self.mode, err, stderr);
                }
                done();
            });
            break;
        case 'unzip':
            exec('unzip -uo {0} -d {1} '.format(file, target), opts, function (err, stdout, stderr) {
                stdout && agent.log(build, Msg.debug, '{2}', stdout);
                if (err || stderr) return agent.buildFailed(build, 'error executing unzip\n{2}\n{3}', err, stderr);
                done();
            });
            break;
        default:
            return _self.buildFailed(build, '7z could not be found!');
    }
};

/**
 * Extract a zip-archive
 *
 * @param {Build} build   - the build object
 * @param {String} file   - path to the zip file
 * @param {String} target - path to the target directory
 * @param {Object} opts   - additional options for the execution
 * @param {function} done - callback function
 */
Archiver.prototype.extractArchive = function (build, file, target, opts, done) {
    var _self = this;
    switch (_self.mode) {
        case '7z':
        case '7z64':
        case 'keka7z':
            var _cmd = '{0} x {1} -o{2} -y'.format(_self.sevenZipPath, file, target);
            exec(_cmd, opts, function (err, stdout, stderr) {
                if (build.conf.status === 'cancelled') {
                    return;
                }
                if (err) {
                    return _self.buildFailed(build, 'Error executing {2}:\nCMD:{3}\nOpts:{4}\nStdout:{5}\nErr:{6}\nStdErr:{7}', _self.sevenZipPath, cmd, JSON.stringify(opts), stdout, err, stderr);
                }
                done();
            });
            break;
        case 'unzip':
            var extrator = unzip.Extract({path: path.resolve(target)});
            fs.createReadStream(file).pipe(extrator);
            extrator.on('error', function (err) {
                if (err) {
                    return _self.buildFailed(build, 'Error unzipping {2}:\nTarget:{3}\nErr:{4}', file, target, err);
                } else {
                    return _self.buildFailed(build, 'Error unzipping {2}:\nTarget:{3}\nError is not available!', file, target);
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
            return _self.buildFailed(build, '7z could not be found!');
    }
};

module.exports = Archiver;
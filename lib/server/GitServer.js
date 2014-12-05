var fs = require('fs-extra');
var path = require('path');
var serverUtils = require('../common/serverUtils');
var gitServer = require('git-server');
var sys = require('sys');
var exec = require('child_process').exec;
var ClientWorker = require('../client/ClientWorker.js');
var maxBuffer = 524288;

function GitServer(conf) {
    this.conf = conf;
}

GitServer.prototype.init = function () {
    var gitconfigPath = path.resolve(this.conf.gitconfig);
    fs.readFile(gitconfigPath, this.listen.bind(this));
};

GitServer.prototype.listen = function (err, repoConfig) {
    if (err) {
        console.log("Reading repo configuration file failed!");
        return false;
    }

    var _self = this;
    var conf = this.conf;
    conf.gitport = conf.gitport || 7000;
    conf.repos = path.resolve(conf.repos); //@TODO: create if not exists
    conf.certs = null;
    if (conf.key && conf.cert) {
        conf.certs = {
            key: fs.readFileSync(path.resolve(conf.key)),
            cert: fs.readFileSync(path.resolve(conf.cert))
        };
    }

    repoConfig = JSON.parse(repoConfig);

    var server = new gitServer(repoConfig, true, conf.repos, conf.gitport, conf.certs);

    server.on('commit', function (update, repo) {
        // do some logging or other stuff
        console.log('Received commit!');
        update.accept(); //accept the update.
    });

    server.on('post-update', function (update, repo) {
        console.log('Post-Update!');
        _self.cloneLocally(repo.path, function (clonePath) {
            _self.gitArchive.call(_self, clonePath, function (zipPath) {
                _self.requestBuild.call(_self, clonePath, zipPath);
            });
        });
    });

    server.on('error', function (err) {
        console.log('Caught gitServer error:');
        console.log(err.stack);
    });
};

GitServer.prototype.cloneLocally = function (repoPath, done) {
    var clonePath = this.conf.tmp;
    var cmd = 'git clone {0} {1}'.format(repoPath, clonePath);
    var zipGit = exec(cmd, {
        cwd: repoPath,
        maxBuffer: maxBuffer
    }, function (error, stdout, stderr) {
        sys.puts(stdout);
    });
    zipGit.on('close', function (code) {
        if (code && code !== 1) {
            console.log('child process exited with code ' + code);
        } else {
            done(clonePath);
        }
    });

    //@todo: remove for prod / make optional > debug mode
    zipGit.stdout.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        console.log(data);
    });

    //@todo: remove for prod / make optional > debug mode
    zipGit.stderr.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        console.log(data);
    });
};

GitServer.prototype.gitArchive = function (repoPath, done) {
    var zipPath = path.resolve(repoPath, 'tmp.zip');
    var zipGit = exec('git archive --format zip --output ' + zipPath + ' master', {
        cwd: repoPath,
        maxBuffer: maxBuffer
    }, function (error, stdout, stderr) {
        sys.puts(stdout);
    });
    zipGit.on('close', function (code) {
        if (code && code !== 1) {
            console.log('child process exited with code ' + code);
        } else {
            done(zipPath);
        }
    });

    //@todo: remove for prod / make optional > debug mode
    zipGit.stdout.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        console.log(data);
    });

    //@todo: remove for prod / make optional > debug mode
    zipGit.stderr.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        console.log(data);
    });
};

GitServer.prototype.requestBuild = function (repoPath, zipPath) {
    var now = new Date();
    var buildName = now.format('YYYY-MM-DD_hh-mm');

    var _buildConf = this.conf;
    _buildConf.save = path.resolve(repoPath, 'build', buildName);
    _buildConf.number = null;
    _buildConf.keep = null;
    _buildConf.files = [zipPath];

    //@TODO: repo build.conf file with certificates => configure 'iosskipsign' dynamically
    _buildConf.iosskipsign = true;

    var client = new ClientWorker(_buildConf);
    client.connect();

    var _self = this;
    client.socket.on('disconnect', function () {
        fs.delete(zipPath, function (err) {
            if (err) {
                console.log('Error deleting temporary zip-file! This isn\'t critical, but not optimal...');
            }
            _self.commitBuild(repoPath, buildName, function () {
                fs.delete(repoPath, function (err) {
                    if (err) {
                        console.log('Error deleting temporary local clone: '+err);
                    }
                });
            });
        });
    });
};

GitServer.prototype.commitBuild = function (repoPath, msg, done) {
    var cmd = 'git add -A && git commit -m "{0}" && git push origin master'.format('build: '+msg);
    var commitBuild = exec(cmd, {
        cwd: repoPath,
        maxBuffer: maxBuffer
    }, function (error, stdout, stderr) {
        sys.puts(stdout);
    });

    commitBuild.on('close', function (code) {
        if (code && code !== 1) {
            console.log('child process exited with code ' + code);
        } else {
            done();
        }
    });

    //@todo: remove for prod / make optional > debug mode
    commitBuild.stdout.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        console.log(data);
    });

    //@todo: remove for prod / make optional > debug mode
    commitBuild.stderr.on('data', function (data) {
        if (data) {//get rid of new lines at the end
            data = data.replace(/\r?\n?$/m, '');
        }
        console.log(data);
    });
};

module.exports = GitServer;
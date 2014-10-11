var fs = require('fs-extra');
var path = require('path');
var fileSize = require('filesize');
var Msg = require('../common/Msg.js');
var serverUtils = require('../common/serverUtils');
var gitServer = require('git-server');
var sys = require('sys');
var exec = require('child_process').exec;
var ClientWorker = require('../client/ClientWorker.js');
var sig = 'GS';
var maxBuffer = 524288;

function GitServer(conf) {
    var _this = this;
    this.conf = conf;

    this.repos = [{
            name: 'myrepo',
            anonRead: false,
            users: [{
                    user: {
                        username: 'demo',
                        password: 'demo'
                    },
                    permissions: ['R', 'W']
                }]
        }];

    this.listen = function () {
        return GitServer.prototype.listen.apply(_this, arguments);
    };
}

GitServer.prototype.listen = function () {
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

    var server = new gitServer(this.repos, true, conf.repos, conf.gitport, conf.certs);
    server.on('commit', function (update, repo) {
        // do some logging or other stuff
        console.log('Received commit!');
        update.accept(); //accept the update.
    });
    server.on('post-update', function (update, repo) {
        console.log('Post-Update!');
        _self.gitArchive.apply(_self, [repo.path, path.resolve(repo.path, 'tmp.zip')]);
    });
    server.on('error', function (err) {
        console.log('Caught gitServer error:');
        console.log(err.stack);
    });
};

GitServer.prototype.gitArchive = function (repoPath, zipPath) {
    var _self = this;
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
            _self.requestBuild.apply(_self, [zipPath, path.resolve(repoPath, 'build')]);
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

GitServer.prototype.requestBuild = function (zipPath, buildDir) {
    var _buildConf = this.conf;
    _buildConf.save = buildDir;
    _buildConf.number = null;
    _buildConf.keep = null; //@TODO: unnecessary because of conf.save?
    _buildConf.files = [zipPath];

    var client = new ClientWorker(_buildConf);
    client.connect();
    client.socket.on('disconnect', function () {
        console.log('Client disconnected!');
    });
};

module.exports = GitServer;
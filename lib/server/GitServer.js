var fs = require('fs-extra');
var path = require('path');
var fileSize = require('filesize');
var Msg = require('../common/Msg.js');
var serverUtils = require('../common/serverUtils');
var gitServer = require('git-server');
var sys = require('sys')
var exec = require('child_process').exec;
var ClientWorker = require('../client/ClientWorker.js');
var sig = 'GS';
var maxBuffer = 524288;

GitServer = (function() {
    function GitServer(conf) {
        var _this = this;
        this.conf = conf;

        this.repos = [{
                name: 'myrepo',
                anonRead: true,
                users: [{
                        user: {
                            username: 'demo',
                            password: 'demo'
                        },
                        permissions: ['R', 'W']
                    }]
            }];

        this.listen = function() {
            return GitServer.prototype.listen.apply(_this, arguments);
        };
    }

    GitServer.prototype.listen = function() {
        var _self = this;
        var conf = this.conf;
        conf.gitport = conf.gitport || 7000;
        conf.repos = path.resolve(conf.repos);
        conf.certs = null;
        if (conf.key && conf.cert) {
            conf.certs = {
                key: fs.readFileSync(path.resolve(conf.key)),
                cert: fs.readFileSync(path.resolve(conf.cert))
            };
        }

        var server = new gitServer(this.repos, true, conf.repos, conf.gitport, conf.certs);
        server.on('commit', function(update, repo) {
            // do some logging or other stuff
            console.log('Received commit!');
            update.accept(); //accept the update.
        });
        server.on('post-update', function(update, repo) {
            console.log('Post-Update!');
            _self.gitArchive.apply(_self, [repo.path, path.resolve(conf.tmp || 'tmp', 'tmp.zip')]);
        });
        server.on('error', function(err) {
            console.log('Caught gitServer error:');
            console.log(err.stack);
        });
    };

    GitServer.prototype.gitArchive = function(repoPath, zipPath) {
        var _self = this;
        var zipGit = exec('git archive --format zip --output ' + zipPath + ' master', {
            cwd: repoPath,
            maxBuffer: maxBuffer
        }, function(error, stdout, stderr) {
            sys.puts(stdout);
        });
        zipGit.on('close', function(code) {
            if (code && code !== 1) {
                console.log('child process exited with code ' + code);
            } else {
                _self.requestBuild.apply(_self, [zipPath]);
            }
        });

        //@todo: remove for prod
        zipGit.stdout.on('data', function(data) {
            if (data) {//get rid of new lines at the end
                data = data.replace(/\r?\n?$/m, '');
            }
            console.log(data);
        });

        //@todo: remove for prodc
        zipGit.stderr.on('data', function(data) {
            if (data) {//get rid of new lines at the end
                data = data.replace(/\r?\n?$/m, '');
            }
            console.log(data);
        });
    };

    GitServer.prototype.requestBuild = function(zipPath) {
        var _buildConf = this.conf;
        _buildConf.save = null;
        _buildConf.number = null;
        _buildConf.keep = null; //@TODO: unnecessary because of conf.save?
        _buildConf.files = [zipPath];

        var client = new ClientWorker(_buildConf);
        client.connect();
        client.socket.on('disconnect', function () {
            console.log('Client disconnected!');
        });
    };

    GitServer.prototype.__proto__ = EventEmitter.prototype;

    return GitServer;
})();

module.exports = GitServer;

// 1) Start Git-Server

// 2) Listen to pushes

// 3) OnPush: check dependencies (isCordovaDir?)

// 4) Generate .zip-File with the latest Commits

// 5) run clientworker with generated zip-file
/*
 if (listen.client) {
 conf.build = (conf.build || 'ios,android,wp8').split(/,|;/g);
 var client = new cordovaBuild.ClientWorker(conf);
 client.connect();
 }*/
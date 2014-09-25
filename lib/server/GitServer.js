var fs = require('fs-extra');
var path = require('path');
var fileSize = require('filesize');
var Msg = require('../common/Msg.js');
var serverUtils = require('../common/serverUtils');
var gitServer = require('git-server');
var sig = 'GS';

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
        var conf = this.conf;
        conf.certs = null;
        if (conf.key && conf.cert) {
            conf.certs = {
                key: path.resolve(conf.key),
                cert: path.resolve(conf.cert)
            };
        }
        
        var server = new gitServer(this.repos, true, conf.location, conf.port, conf.certs);
        server.on('commit', function(update, repo) {
            // do some logging or other stuff
            console.log('Received commit!');
            update.accept(); //accept the update.
        });
        server.on('post-update', function(update, repo) {
            console.log('Post-Update!');
            //do some deploy stuff
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
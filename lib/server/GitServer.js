var fs = require('fs-extra');
var path = require('path');
var fileSize = require('filesize');
var Msg = require('../common/Msg.js');
var serverUtils = require('../common/serverUtils');
var pushover = require('pushover');
var sig = 'GS';

var express = require('express');
var https = require('https');
var http = require('http');

GitServer = (function() {
    function GitServer(conf) {
        var _this = this;
        this.conf = conf;

        this.listen = function() {
            return GitServer.prototype.listen.apply(_this, arguments);
        };
    }

    GitServer.prototype.listen = function() {
        var conf = this.conf;
        
        var repoPath = path.resolve(conf.location);
        var repos = pushover(repoPath, {
            autoCreate: false,
            checkout: false
        });
        
        repos.create('myrepo', function (err) {
            if (err) {
                console.log(err);
            }
            console.log('myrepo created');
        });
        
        console.log('Setting pushover directory to '+repoPath);

        repos.on('push', function (push) {
            console.log('push ' + push.repo + '/' + push.commit + ' (' + push.branch + ')');
            push.accept();
        });
        repos.on('tag', function (tag) {
            console.log('tag ' + tag.commit);
            tag.accept();
        });
        repos.on('fetch', function (fetch) {
            console.log('fetch ' + fetch.commit);
            fetch.accept();
        });
        repos.on('info', function (info) {
            console.log('info ' + info.repo);
            info.accept();
        });
        repos.on('head', function (head) {
            console.log('head ' + head.repo);
            head.accept();
        });
        
        if (conf.key && conf.cert) {
            conf.certs = {
                key: fs.readFileSync(path.resolve(conf.key)),
                cert: fs.readFileSync(path.resolve(conf.cert))
            };
            
            var _sslPort = conf.ssl || 443;
            console.log('Starting HTTPS-Server at '+sslPort);
            var sslServer = https.createServer(conf.certs, function (req, res) {
                console.log('HTTPS-Server Request');
                repos.handle(req, res);
            });
            sslServer.listen(_sslPort);
        }
        
        if (!conf.sslonly) {
            var _port = conf.port || 8400;
            console.log('Starting HTTP-Server at '+_port);
            var server = http.createServer(function (req, res) {
                console.log('HTTP-Server Request');
                repos.handle(req, res);
            });
            server.listen(_port);
        }
    };

    return GitServer;
})();

module.exports = GitServer;

// 1) Start Git-Server

// 2) Listen to pushes

// 3) OnPush: check dependencies (isCordovaDir?)

// 4) Generate .zip-File with the latest Commits

// 5) run clientworker with generated zip-file
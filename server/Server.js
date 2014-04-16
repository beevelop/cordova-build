
module.exports = Server;
var Build = require('../common/Build');
var Msg = require('../common/Msg.js');
var Client = require('./Client');
var Agent = require('./Agent');
var WWW = require('./WWW');
var serverUtils = require('../common/serverUtils');
var BrowserDetect = require('../common/BrowserDetect');
var IPAFile = require('./ipa/ipa-file.js');

    //patch on to support binding with multiple events at once

var path = require('path');
var fs = require('fs');
var multiGlob = require('multi-glob');
var async = require('async');
var mkdirp = require('mkdirp');
var io = require('socket.io');
var http = require('http');
var express = require('express');
var extend = require('extend');
var CircularJSON = require('circular-json');
var mu = require('mu2');

function Server(conf) {
    this.conf = conf || {};
    this.agents = [];
    this.buildsQueue = [];
    this.clients = [];
    this.logs = [];
    this.wwws = [];
    this.platforms = {};
    this.builds = [];
    var m = {
        "conf": {
            "status": "success",
            "started": "2014-04-15T23:33:08.230Z",
            "platform": [
              "ios"
            ],
            "iosprojectpath": "platforms\/ios\/build\/device\/Safetybank.app",
            "iosprovisioningname": "iPhone Developer: Tudor Dumitriu (7XAE2UT2Y6)",
            "iosprovisioningpath": "\/usr\/local\/provisions\/safetybank.mobileprovision",
            "completed": "2014-04-15T23:33:38.409Z",
            "duration": "30 seconds"
        },
        "id": "xJqd1Po3n",
        "files": [
          {
              "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\input\\core.7z",
              "group": null
          },
          {
              "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\input\\www.7z",
              "group": null
          },
          {
              "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\input\\wp8.7z",
              "group": "wp8"
          },
          {
              "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\input\\android.7z",
              "group": "android"
          },
          {
              "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\input\\ios.7z",
              "group": "ios"
          }
        ],
        "platforms": [
          {
              "conf": {
                  "status": "success",
                  "started": "2014-04-15T23:33:08.230Z",
                  "platform": "ios",
                  "iosprojectpath": "platforms\/ios\/build\/device\/Safetybank.app",
                  "iosprovisioningname": "iPhone Developer: Tudor Dumitriu (7XAE2UT2Y6)",
                  "iosprovisioningpath": "\/usr\/local\/provisions\/safetybank.mobileprovision",
                  "completed": "2014-04-15T23:33:38.392Z",
                  "duration": "30 seconds"
              },
              "id": "eklt1Pj23",
              "masterId": "xJqd1Po3n",
              "files": [
                "~files~0",
                "~files~1",
                "~files~4"
              ],
              "outputFiles": [
                {
                    "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\Safetybank.xJqd1Po3n.ipa"
                },
                {
                    "file": "D:\\Work\\DotNetWise\\Nuggets\\cordova-build\\builds\\xJqd1Po3n\\Info.xJqd1Po3n.plist"
                }
              ]
          }
        ]
    };
    var build = new Build(m);
    this.registerBuild(build);

    this.location = conf.location || path.resolve('builds');
    var cache = this.cache = {};
    var www = this.www = __dirname + '/public';
    var htmlFiles = ['index.html', 'server.html'];
    var encoding = { encoding: 'utf-8' };
    var server = this;
    htmlFiles.forEach(function (file) {
        var path = www + '/' + file;
        var lastTime = new Date();
        read();
        fs.watch(path, function (event, filename) {
            if (lastTime < new Date()) {
                lastTime = new Date(new Date().getTime() + 500);//500 ms treshold to avoid duplicates on windows
                setTimeout(function () {
                    read(true);
                }, 100);
            }
        });
        function read(async) {
            if (async)
                fs.readFile(path, encoding, function (err, content) {
                    cache[file] = err || content;
                    server.wwws && server.wwws.socket && server.wwws.socket.emit.defer(500, server.wwws.socket, 'reload');
                });
            else cache[file] = fs.readFileSync(path, encoding);
        }
    });
};
Server.define({
    registerBuild: function (build) {
        this.builds.push(build);
        this.builds[build.id] = build;
        build.platforms.forEach(function (platformBuild) {
            this.builds[platformBuild.id] = platformBuild;
        }.bind(this));
    },
    listen: function () {
        var conf = this.conf;
        var www = this.www;
        var cache = this.cache;
        var server = conf ? this : new Server();
        this.uiApp = express();
        this.uiHttpServer = http.createServer(this.uiApp);

        var uiOnly = conf.mode == 'ui';
        conf.port = conf.port || 8300;
        conf.uiport = conf.uiport == 0 || conf.uiport == false ? false : conf.uiport || 8300;
        if (conf.uiport) console.log('Cordova build INTERFACE is accesible at {0}{1}{2}/'.format(conf.proxyprotocol || conf.uiprotocol || 'http://', conf.proxy || conf.ui || 'localhost', (conf.proxyport || conf.uiport) == 80 ? '' : ':' + (conf.proxyport || conf.uiport)));
        if (!conf.uiport) console.log('Cordova build INTERFACE is disabled because you have specified -ui:false');
        console.log('Cordova build    SERVER is {0} at {1}{2}{3}/\n'.format(uiOnly ? 'targeted' : 'hosted', conf.protocol, conf.server, conf.port == 80 ? '' : ':' + conf.port));

        if (uiOnly)
            this.socket = null;
        else {
            if (conf.uiport != conf.port) {
                this.buildServerApp = express();
                this.buildHttpServer = http.createServer(this.buildServerApp);
                this.socket = io.listen(this.buildHttpServer);
                this.buildServerApp
					.use(this.buildServerApp.router)
					.use(express.static(www))
					.get('/', function (req, res) {
					    res.setHeader('Content-Type', 'text/html');
					    var html = cache['server.html'].replace('<script id="start"></script>', '<script id="start">var serverBrowser = new ServerBrowser({0});</script>'.format(JSON.stringify({
					        protocol: conf.protocol,
					        host: conf.server,
					        port: conf.publicport || conf.port,
					    })));
					    res.send(html);
					});
            }
            else this.socket = io.listen(this.uiHttpServer);
            this.socket.set('log level', 2);//show warnings
        }

        if (conf.uiport) {
            this.uiApp
				.use(this.uiApp.router)
				.use(express.static(www))
				.get('/', function (req, res) {
				    res.setHeader('Content-Type', 'text/html');
				    var html = cache['index.html'].replace('<script id="start"></script>', '<script id="start">var serverBrowser = new ServerBrowser({0});</script>'.format(JSON.stringify({
				        protocol: conf.proxyprotocol || conf.uiprotocol || conf.protocol || 'http://',
				        host: conf.proxy || conf.ui || conf.server,
				        port: conf.proxyport || config.uiport || conf.port,
				    })));
				    res.send(html);
				})
				.get('/serve/:id/:platform?/:file?', this.serveRelease.bind(this))
				.get('/download/:id/:platform?/:file?', this.downloadRelease.bind(this))
				.get('/manifest/:id/:file?', this.downloadManifest.bind(this));
        }

        if (!uiOnly) {
            this.agents.socket = this.socket
				.of('/agent')
				.on({
				    'connection': function (socket) {
				        var agent = new Agent(socket);
				        agent.onConnect(server);
				        socket.on({
				            'disconnect': function () {
				                try {
				                    this.log(new Msg(null, agent, 'S', Msg.debug, 'The agent with id {0} has disconnected. Bye!'), agent);
				                    agent.onDisconnect();
				                    server.agents.remove(agent);
				                    agent.platforms.forEach(function (platform) {
				                        server.platforms[platform].remove(agent);
				                    });
				                    if (agent.busy) {
				                        var build = agent.busy;
				                        this.log(new Msg(build, agent, 'S', Msg.warning, 'the agent {3} has been disconnected. The build on {2} will be added back to queue', build.platform, agent.id), build.client);
				                        build.agent = null;
				                        this.updateBuildStatus(build, 'queued');
				                        this.buildsQueue.push(build);
				                    }
				                }
				                finally {
				                    this.notifyStatusAllWWWs('disconnected', 'agent', agent.conf);
				                }
				            },
				            'register': function (conf) {
				                agent.id = conf && conf.id;
				                this.log(new Msg(null, agent, 'S', Msg.debug, 'An agent with id {0} has just connected supporting the platforms [{2}]', agent.platforms.join(', ')), null);
				                server.agents.push(agent);
				                agent.platforms.forEach(function (platform) {
				                    (server.platforms[platform] = server.platforms[platform] || []).push(agent);
				                });
				                agent.conf.platforms = agent.platforms;
				                agent.conf.since = new Date();
				                conf.status = 'ready';
				                this.notifyStatusAllWWWs('connected', 'agent', agent.conf);
				            },
				        }, this);
				    },
				}, this);


            this.clients.socket = this.socket
				.of('/client')
				.on({
				    'connection': function (socket) {
				        var client = new Client(socket);
				        server.clients.push(client);
				        client.onConnect(server);
				        socket.on({
				            'register': function (conf) {
				                client.id = conf.id;
				                this.clients[conf.id] = client;
				                this.log(new Msg(null, client, 'S', Msg.debug, 'A client with id {0} has just connected. Welcome!'), client);
				            },
				            'disconnect': function () {
				                this.log(new Msg(null, client, 'S', Msg.debug, 'The client with id {0} has disconnected. Bye!'), client);
				                client.onDisconnect();
				                this.clients.remove(client);
				            },
				        }, this);
				        //socket.emit('news', { news: 'item' });
				    },
				}, this);
            this.wwws.socket = this.socket
				.of('/www')
				.on({
				    'connection': function (socket) {
				        var www = new WWW(socket);
				        server.wwws.push(www);
				        www.onConnect(server);
				        socket.on({
				            'disconnect': function () {
				                www.onDisconnect();
				                this.wwws.remove(www);
				            },
				            'rebuild': function (build) {
				                var build = server.builds[build];
				                if (build) {
				                    server.updateBuildStatus(build, 'queued');
				                    var platforms = build.master ? [build] : build.platforms;
				                    server.log(new Msg(build, build.client, 'S', Msg.status, 'This build as been rescheduled for rebuild'), build.client);

				                    platforms.forEach(function (platformBuild) { server.buildsQueue.push(platformBuild); });
				                }
				            },
				        }, this);
				        //socket.emit('news', { news: 'item' });
				    },

				}, this);

            this.log(new Msg(null, null, 'S', Msg.info, 'listening on port {2}', conf.port), null);
            this.processQueueInterval = setInterval(this.processQueue.bind(this), 1000);
        }
        if (conf.uiport)
            this.uiHttpServer.listen(conf.uiport);
        if (this.buildHttpServer) {
            this.buildHttpServer.listen(conf.port);
        }

    },
    stop: function () {
        clearInterval(this.processQueueInterval);
        this.socket.server.close();
        process.exit();
    },
    notifyStatusAllWWWs: function (kind, what, obj) {
        this.wwws.socket.emit('news', arguments.length == 1 ? kind : {
            kind: kind,
            what: what,
            obj: obj,
        });
    },
    updateBuildStatus: function (build, status, doNotLogOnMaster) {
        var buildParam = build;
        if (build && !build.updateStatus) {
            //self detect build if an id was passed
            build = this.builds[build];
        }
        if (build.master && !doNotLogOnMaster && build.status != status) {
            var msg = new Msg(build.master, null, 'S', Msg.status, 'Platform {2} update status: {3}', build.conf.platform, status);
            this.log(msg, null);
        }
        if (build && build.updateStatus) {
            build.updateStatus(status);
            this.notifyStatusAllWWWs(status, 'build', build.serialize({ platforms: 1 }));
        }
        else {
            this.log(buildParam, null, 'S', Msg.error, "A request to change a build's status to {2} was made but that build cannot be found. We have tried to identify it by {3}", status, buildParam);
        }
    },
    processQueue: function () {
        var build = this.buildsQueue.shift();
        if (build) {
            var server = this;
            var platform = build.conf.platform;
            var startBuilding = false;
            var agents = server.platforms[platform];
            agents && agents.every(function (agent) {
                if (!agent.busy) {
                    agent.startBuild(build);
                    startBuilding = true;
                    return false;
                }
                return true;
            });
            if (!startBuilding)
                this.buildsQueue.push(build);
        }
    },
    log: function (msg, forwardToClientOrAgent) {
        if (this.conf.mode != 'all' || !forwardToClientOrAgent) {
            console.log(msg.toString());
        }
        //broadcast the log to all wwws
        var build = this.findBuildById(msg.buildId);
        if (build && build.conf)
            build.conf.logs.unshift(msg);

        this.logs.unshift(msg);
        this.notifyStatusAllWWWs('log', 'log', msg);
        forwardToClientOrAgent && forwardToClientOrAgent.emitLog(msg);
    },
    forwardLog: function (build, sender, msg, to) {
        //timestamp msg with server's time
        msg && (msg.date = new Date());

        if (!to) {
            build = this.findBuildById(build);
            to = build && build.client;
        }
        build && build.conf.logs.unshift(msg);
        if (to && to != sender)
            to.emitLog(msg);
        this.logs.unshift(msg);
        this.notifyStatusAllWWWs('log', 'log', msg);
    },
    findBuildById: function (build) {
        var buildFound = typeof build == 'string' || build && build.id ? this.builds[build && build.id || build] || build && build.id && build : build;
        return buildFound;
    },
    detectPlatform: function (build, req) {
        var platform = req.params.platform || 'autodetect';
        switch (platform) {
            case 'android':
            case 'ios':
            case 'wp8':
                break;
            case 'autodetect':
            default:
                var browser = new BrowserDetect(req.headers['user-agent']);
                if (browser.android())
                    platform = 'android';
                if (browser.iOS())
                    platform = 'ios';
                if (browser.windows())
                    platform = 'wp8';
                //for now assuming we need the xap in any other case
                //platform = 'wp8';
                break;
        }
        if (platform == 'autodetect') {
            if (build) {
                if (build.master) build = build.master;
                if (Array.isArray(build.platforms))
                    build.platforms.every(function (platformBuild) {
                        if (platformBuild && platformBuild.conf && platformBuild.conf.status == 'success') {
                            platform = platformBuild.conf.platform;
                            return false;
                        }
                        return true;
                    });
            }
        }
        return platform;
    },
    downloadRelease: function (req, res) {
        var parsedBuild = this.parseBuildRequest(req, res);
        if (!parsedBuild) return;
        var platform = parsedBuild.platform;
        var build = parsedBuild.build; req.url;
        //var m = CircularJSON.stringify((build && build.master || build).serialize({ files: 1, outputFiles: 1, platforms: 1 }, { files: 1, outputFiles: 1 }));
        if (platform == 'ios' && req.params.file == 'qr') {
            var port = this.conf.proxyport || this.conf.port;
            var url = [
                req.protocol,
                '//',
                this.conf.proxy || this.conf.server,
                port != 80 ? ':' : '',
                port != 80 ? port : '',
                '/manifest/',
                build.id,
                '/manifest.plist',
            ].join('');
            url = 'itms-services://?action=download-manifest&url={0}'.format(encodeURIComponent(url));
            return res.redirect(url);
        }
        else this.serveRelease(req, res);
    },
    downloadManifest: function (req, res) {
        var platform = req.params.platform = 'ios';
        var parsedBuild = this.parseBuildRequest(req, res);
        if (!parsedBuild) return;
        var build = parsedBuild.build; req.url

        if (platform == 'ios') {
            var port = this.conf.proxyport || this.conf.port;
            var baseURL = [
					req.protocol,
					'//',
					this.conf.proxy || this.conf.server,
					port != 80 ? ':' : '',
					port != 80 ? port : '',
					'/serve/',
					build.id,
					'/ios/'
            ].join('');
            var ipaPath = build.outputFiles[0].file;
            var Info_plist = build.outputFiles.findOne(function(file) { return path.basename(file.file) == 'Info.plist'; });
            var file = build.ipaFile || new IPAFile(ipaPath, Info_plist);
            build.ipaFile = file;
            var manifest = {
                fileURL: baseURL + path.basename(ipaPath || 'application.ipa'),
                displayImage: baseURL + '57.png',
                fullSizeImage: baseURL + '512.png',
                bundleIdentifier: file.id,
                subtitle: file.team,
                title: file.name
            };

            res.writeHead(200, { 'Content-Type': 'text/xml' });
            mu.compileAndRender(__dirname + '/ipa/manifest.xml', manifest).pipe(res);
        }
    },
    serveRelease: function (req, res) {
        //if (platform == build.conf.platform) {
        var parsedBuild = this.parseBuildRequest(req, res);
        if (!parsedBuild) return;
        var build = parsedBuild.build;
        var platform = parsedBuild.platform;
        var askForFile = req.param.file;
        if (askForFile) {
            var ipaFile = build.ipaFile || new IPAFile(ipaPath, build.outputFiles[1] && build.outputFiles[1].file);
            build.ipaFile = ipaFile;
            switch (askForFile) {
                case '57.png':
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    res.end(file.icon);
                    return;
                case '512.png':
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    var filestream = fs.createReadStream(__dirname + '/512.png');
                    filestream.pipe(res);
                    return;
                default:
                    res.send(500, 'There is no file with name {0} known for build {1}!'.format(askForFile, build.id));
                    return;
            }
        }

        var file = build.outputFiles[0].file;
        var filename = path.basename(file);
        if (platform != 'ios')
            res.setHeader('Content-disposition', 'attachment; filename=' + filename);
        res.setHeader('Content-type', this.mime_types[platform] || this.mime_types.ios);

        var filestream = fs.createReadStream(file);
        filestream.pipe(res);
    },
    mime_types: { android: 'application/vnd.android.package-archive', wp8: 'application/x-silverlight-app', ios: 'application/octet-stream' },
    parseBuildRequest: function (req, res) {
        var buildId = req.params.id;
        var build = this.builds[buildId]
        if (!build || !build.conf) {
            res.send(500, 'There is no built with id {0} to be found!'.format(buildId));
            return;
        }
        var platform = this.detectPlatform(build, req);

        if (platform == 'autodetect') {
            res.send(500, 'We could not detect your platform. Please download a specific platform from the nearby tabs!'.format(buildId));
            return;
        }
        if (build.master) {
            var master = build.master;

            var platformBuild = master.platforms.findOne(function (build) {
                return build && build.conf && build.conf.platform == platform;
            });
            if (!platformBuild) {
                res.send(500, "The specified build {0} was not requested on {1}!".format(buildId, platform));
                return;
            }
            build = platformBuild;
        }
        else {
            var platformBuild = build.platforms && build.platforms.findOne(function (build) {
                return build && build.conf && build.conf.platform == platform;
            });
            if (!platformBuild) {
                res.send(500, 'The build {0} contains no child builds on platform {1}!'.format(buildId, platform));
                return;
            }
            build = platformBuild;
            //    res.send(500, "The specified build {0} was not requested on {1}!".format(buildId, platform));
            //    return;
        }
        //}
        if (!build.conf || build.conf.status != 'success') {
            res.send(500, 'The build {0} has not completed successfully yet. Currently it is on status: {1}!'.format(buildId, build.conf.status));
            return;
        }

        if (!build.outputFiles || !build.outputFiles.length) {
            res.send(500, 'There are no output files for the build {0}!'.format(buildId));
            return;
        }
        return { build: build, platform: platform };
    },
});
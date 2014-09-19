module.exports = Server;
var Build = require('../common/Build'),
        Msg = require('../common/Msg.js'),
        Client = require('./Client'),
        Agent = require('./Agent'),
        WWW = require('./WWW'),
        BrowserDetect = require('../common/BrowserDetect'),
        IPAFile = require('./ipa/ipa-file.js'),
        path = require('path'),
        fs = require('fs-extra'),
        multiGlob = require('multi-glob'),
        async = require('async'),
        io = require('socket.io'),
        http = require('http'),
        express = require('express'),
        mu = require('mu2');


function Server(conf) {
    this.conf = conf || {};
    this.agents = [];
    this.buildsQueue = [];
    this.clients = [];
    this.logs = [];
    this.wwws = [];
    this.platforms = {};
    this.builds = [];
    this.location = conf.location || path.resolve('builds');
    var server = this;
    multiGlob.glob(server.location + '/*/build.json', function (err, builds) {
        builds.sort();
        var loadedBuilds = [];
        var orderedBuilds = {};
        async.each(builds, function (buildPath, cb) {
            fs.readFile(buildPath, function (err, data) {
                var buildJSON;
                try {
                    buildJSON = JSON.parse(data);
                } catch (e) {
                    return cb(e);
                }
                var build = new Build(buildJSON);
                loadedBuilds.push(build);
                orderedBuilds[buildPath] = build;
                cb();
            });
        }, function (err) {
            builds.forEach(function (buildPath) {
                var build = orderedBuilds[buildPath];
                if (build) {
                    server.builds.push(build);
                    server.builds[build.id] = build;
                    if (build.platforms) {
                        build.platforms.forEach(function (platformBuild) {
                            server.builds[platformBuild.id] = platformBuild;
                        });
                    }
                }
            });
            if (loadedBuilds.length) {
                server.log(new Msg(null, null, 'S', Msg.debug, '{2} previous build(s) were successfully read from the disk', loadedBuilds.length));
            }
            if (err) {
                server.log(new Msg(null, null, 'S', Msg.debug, 'an error occurred while trying to read previous build(s) from the disk\n{2}', err));
            }
        });
    });
    var cache = this.cache = {};
    var www = this.www = path.resolve(__dirname, '../../www');
    var htmlFiles = ['index.html', 'server.html'];
    var encoding = {encoding: 'utf-8'};
    htmlFiles.forEach(function (file) {
        var file_path = path.resolve(www, file);
        var lastTime = new Date();
        read();
        fs.watch(file_path, function () {
            if (lastTime < new Date()) {
                lastTime = new Date(new Date().getTime() + 500);//500 ms treshold to avoid duplicates on windows
                setTimeout(function () {
                    read(true);
                }, 100);
            }
        });
        function read(async) {
            if (async) {
                fs.readFile(file_path, encoding, function (err, content) {
                    cache[file] = err || content;
                    if (server.wwws && server.wwws.socket) {
                        server.wwws.socket.emit.defer(500, server.wwws.socket, 'reload');
                    }
                });
            } else {
                cache[file] = fs.readFileSync(file_path, encoding);
            }
        }
    });
}

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
        var server = conf ? this : new Server();

        var uiOnly = conf.mode === 'ui';
        conf.uiport = conf.uiport === 0 || conf.uiport === false ? false : conf.uiport || 8300;
        var interfacePort = conf.proxyport || conf.uiport || conf.port;
        if (conf.uiport) {
            console.log('Cordova build INTERFACE is accesible at {0}{1}{2}/'.format(conf.proxyprotocol || conf.uiprotocol || conf.protocol || 'http://', conf.proxy || conf.ui || conf.server || 'localhost', interfacePort === 80 ? '' : ':' + interfacePort));
        } else {
            console.log('Cordova build INTERFACE is disabled because you have specified -uiport:0');
        }

        console.log('Cordova build SERVER is {0} at {1}{2}{3}/\n'.format(uiOnly ? 'targeted' : 'hosted', conf.protocol, conf.server, conf.port === 80 ? '' : ':' + conf.port));

        if (uiOnly) {
            this.socket = null;
        } else {
            if (conf.uiport !== conf.port) {
                this.startBuildServer();
            } else {
                this.socket = io.listen(this.uiHttpServer, {
                    'destroy buffer size': Infinity
                });
            }
            this.socket.set('log level', 2);//show warnings
        }

        this.socket.enable('browser client minification');  // send minified client
        this.socket.enable('browser client etag');          // apply etag caching logic based on version number
        this.socket.enable('browser client gzip');          // gzip the file
        this.socket.set('log level', 1);                    // reduce logging
        this.socket.set('transports', ['websocket', 'flashsocket', 'htmlfile', 'xhr-polling', 'jsonp-polling']); // enable all transports

        if (conf.uiport) {
            this.startUI();
        }

        if (!uiOnly) {
            this.agents.socket = this.agentsSocket(server);
            this.clients.socket = this.clientsSocket(server);
            this.wwws.socket = this.wwwsSocket(server);

            this.log(new Msg(null, null, 'S', Msg.info, 'listening on port {2}', conf.port), null);
            this.processQueueInterval = setInterval(this.processQueue.bind(this), 1000);
        }
        if (conf.uiport) {
            this.uiHttpServer.listen(conf.uiport);
        }
        if (this.buildHttpServer) {
            this.buildHttpServer.listen(conf.port);
        }
    },
    startBuildServer: function () {
        var conf = this.conf;
        this.buildServerApp = express();
        this.buildHttpServer = http.createServer(this.buildServerApp);
        this.socket = io.listen(this.buildHttpServer, {
            'destroy buffer size': Infinity
        });
        this.buildServerApp
                .get('/', function (req, res) {
                    res.setHeader('Content-Type', 'text/html');
                    var html = this.cache['server.html'].replace('<script id="start"></script>', '<script id="start">var serverBrowser = new ServerBrowser({0});</script>'.format(JSON.stringify({
                        protocol: conf.protocol,
                        host: conf.server,
                        port: conf.port
                    })));
                    res.send(html);
                })
                .use(express.static(this.www));
    },
    startUI: function () {
        var conf = this.conf;
        this.uiApp = express();
        this.uiHttpServer = http.createServer(this.uiApp);
        this.uiApp
                .get('/', function (req, res) {
                    res.setHeader('Content-Type', 'text/html');
                    var html = this.cache['index.html'].replace('<script id="start"></script>', '<script id="start">var serverBrowser = new ServerBrowser({0});</script>'.format(JSON.stringify({
                        protocol: conf.proxyportocol || conf.protocol || 'http://',
                        host: conf.server,
                        port: conf.proxyport || conf.port,
                        promote: conf.promote
                    })));
                    res.send(html);
                })
                .get('/serve/:id/:platform?/:file?', this.serveRelease.bind(this))
                .get('/download/:id/:platform?/:file?', this.downloadRelease.bind(this))
                .get('/manifest/:id/:file?', this.downloadManifest.bind(this))
                .use(express.static(this.www));
    },
    agentsSocket: function (server) {
        return this.socket
                .of('/agent')
                .on({
                    'connection': function (socket) {
                        var agent = new Agent(socket);
                        agent.onConnect(server);
                        socket.on({
                            'disconnect': function () {
                                try {
                                    this.log(new Msg(agent.busy, agent, 'S', Msg.debug, 'The agent with id {0} has disconnected. Bye!'), agent.busy && agent.busy.client);
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
                                        var buildPath = path.resolve(this.location, build.master && build.master.Id() || build.Id(), 'build.' + build.conf.platform + '.json');
                                        build.save(buildPath, function (err) {
                                            if (err) {
                                                this.log(new Msg(build, agent, 'S', Msg.debug, err), build.client);
                                            }
                                        });
                                        if (build.master) {
                                            buildPath = path.resolve(this.location, build.master && build.master.Id(), 'build.json');
                                            build.master.save(buildPath, function (err) {
                                                if (err) {
                                                    this.log(new Msg(build, agent, 'S', Msg.debug, err), build.client);
                                                }
                                            });
                                        }
                                        this.buildsQueue.push(build);
                                    }
                                } finally {
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
                            }
                        }, this);
                    }
                }, this);
    },
    wwwsSocket: function (server) {
        return this.socket
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
                            'rebuild': function (build_id) {
                                var build = server.builds[build_id];
                                if (build) {
                                    server.updateBuildStatus(build, 'queued');
                                    var platforms = build.master ? [build] : build.platforms;
                                    server.log(new Msg(build, build.client, 'S', Msg.status, 'This build as been rescheduled for rebuild'), build.client);

                                    platforms.forEach(function (platformBuild) {
                                        server.buildsQueue.push(platformBuild);
                                    });
                                }
                            },
                            'cancel': function (build_id) {
                                var build = server.builds[build_id];
                                if (build) {
                                    server.updateBuildStatus(build, 'cancelled');
                                    server.buildsQueue.remove(build);
                                    if (build.client) {
                                        if (build.client.socket) {
                                            try {
                                                build.client.socket.emit('build-failed', build.id);
                                            } catch (e) {
                                            }
                                        }
                                    }
                                    server.log(new Msg(build, build.agent, 'S', Msg.error, 'The build has been cancelled on user\'s request'), build.client);
                                    if (build.agent) {
                                        if (build.agent.socket) {
                                            try {
                                                build.agent.socket.emit('cancel', build.id);
                                            } catch (e) {
                                            }
                                        }
                                        build.agent.busy = null;
                                    }
                                }
                            }
                        }, this);
                    }
                }, this);
    },
    clientsSocket: function (server) {
        return this.socket
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
                            }
                        }, this);
                    }
                }, this);
    },
    stop: function () {
        clearInterval(this.processQueueInterval);
        this.socket.server.close();
        process.exit();
    },
    notifyStatusAllWWWs: function (kind, what, obj) {
        this.wwws.socket.emit('news', arguments.length === 1 ? kind : {
            kind: kind,
            what: what,
            obj: obj
        });
    },
    updateBuildStatus: function (build, status, doNotLogOnMaster) {
        var buildParam = build;
        var server = this;
        if (build && !build.updateStatus) {
            //self detect build if an id was passed
            build = server.builds[build];
        }
        if (!build) {
            server.log(new Msg(null, null, 'S', Msg.error, 'Build not found with id: {2}', buildParam));
            return;
        }
        if (build.master && !doNotLogOnMaster && build.status !== status) {
            var msg = new Msg(build.master, null, 'S', Msg.status, 'Platform {2} update status: {3}', build.conf.platform, status);
            server.log(msg, null);
        }
        if (build && build.updateStatus) {
            if (status === 'deleted') {
                delete server.builds[build.id];
                server.builds.remove(build);
                server.buildsQueue.remove(build);
                if (build.master) {
                    build.master.platforms.remove(build);
                }
                else if (build.platforms) {
                    build.platforms.forEach(function (platformBuild) {
                        delete server.builds[platformBuild.id];
                        server.builds.remove(platformBuild);
                        server.buildsQueue.remove(platformBuild);
                    });
                }
            } else {
                build.updateStatus(status, server.location);
            }
            server.notifyStatusAllWWWs(status, 'build', build.serialize({platforms: 1}));
        } else {
            server.log(buildParam, null, 'S', Msg.error, "A request to change a build's status to {2} was made but that build cannot be found. We have tried to identify it by {3}", status, buildParam);
        }
    },
    processQueue: function () {
        var build = this.buildsQueue.shift();
        while (build) {
            var server = this;
            var platform = build.conf.platform;
            var startBuilding = false;
            var agents = server.platforms[platform];
            if (agents) {
                startBuilding = this.loopAgents(agents, build);
            }
            if (!startBuilding) {
                this.buildsQueue.push(build);
                build = null;
            } else {
                build = this.buildsQueue.shift();
            }
        }
    },
    loopAgents: function (agents, build) {
        var startBuilding = false;
        agents.every(function (agent) {
            if (!agent.busy) {
                agent.startBuild(build);
                startBuilding = true;
                return false;
            }
            return true;
        });
        return startBuilding;
    },
    log: function (msg, forwardToClientOrAgent) {
        if (this.conf.mode !== 'all' || !forwardToClientOrAgent) {
            console.log(msg.toString());
        }
        if (/Command failed/i.test(msg && msg.message)) {
            try {
                throw new Error("server stack");
            } catch (e) {
                msg.message += e.stack;
            }
        }
        //broadcast the log to all wwws
        var build = this.findBuildById(msg.buildId);
        if (build && build.conf) {
            build.conf.logs.unshift(msg);
        }

        this.logs.unshift(msg);
        this.notifyStatusAllWWWs('log', 'log', msg);
        if (forwardToClientOrAgent) {
            forwardToClientOrAgent.emitLog(msg);
        }
    },
    forwardLog: function (build, sender, msg, to) {
        //timestamp msg with server's time
        if (msg) {
            msg.date = new Date();
        }
        if (!to) {
            build = this.findBuildById(build);
            to = build && build.client;
        }
        if (build) {
            build.conf.logs.unshift(msg);
        }
        if (to && to !== sender) {
            to.emitLog(msg);
        }
        this.logs.unshift(msg);
        this.notifyStatusAllWWWs('log', 'log', msg);
    },
    findBuildById: function (build) {
        if (typeof build === 'string' || build && build.id) {
            var buildFound = this.builds[build && build.id || build] || build && build.id && build;
            return buildFound;
        } else {
            if (build) {
                console.error(build);
                throw "could not parse build";
            }
        }
        return build;
    },
    detectPlatform: function (build, req) {
        var platform = req.params.platform || 'autodetect';
        if (req.params.file === 'qr') {
            platform = 'autodetect';
        }
        //@TODO: simple if...?
        switch (platform) {
            case 'android':
            case 'ios':
            case 'wp8':
                break;
                //case 'autodetect':
            default:
                var browser = new BrowserDetect(req.headers['user-agent']);
                if (browser.android()) {
                    platform = 'android';
                }
                if (browser.iOS()) {
                    platform = 'ios';
                }
                if (browser.windows()) {
                    platform = 'wp8';
                }
                break;
        }
        if (platform === 'autodetect') {
            if (build) {
                if (build.master) {
                    build = build.master;
                }
                if (Array.isArray(build.platforms)) {
                    build.platforms.every(function (platformBuild) {
                        if (platformBuild && platformBuild.conf && platformBuild.conf.status === 'success') {
                            platform = platformBuild.conf.platform;
                            return false;
                        }
                        return true;
                    });
                }
            }
        }
        return platform;
    },
    downloadRelease: function (req, res) {
        var parsedBuild = this.parseBuildRequest(req, res);
        if (!parsedBuild) {
            return;
        }
        var platform = parsedBuild.platform;
        var build = parsedBuild.build;
        //var m = CircularJSON.stringify((build && build.master || build).serialize({ files: 1, outputFiles: 1, platforms: 1 }, { files: 1, outputFiles: 1 }));
        if (platform === 'ios' && (req.params.file === 'qr' || (/iPhone|iPad|iPod/).test(req.headers['user-agent']))) {
            var port = this.conf.proxyport || this.conf.uiport || this.conf.port;
            var url = [
                this.conf.proxyprotocol || this.conf.serverprotocol || req.protocol && (req.protocol + '://') || 'http://',
                this.conf.proxy || this.conf.server,
                port !== 80 ? ':' : '',
                port !== 80 ? port : '',
                '/manifest/',
                build.id,
                '/Info.plist'
            ].join('');
            var manifestUrl = build.conf.iosmanifesturl || this.conf.iosmanifesturl ? (build.conf.iosmanifesturl || this.conf.iosmanifesturl).format("Info.plist", encodeURIComponent(url)) : url;

            url = 'itms-services://?action=download-manifest&url={0}'.format(encodeURIComponent(manifestUrl));
            return res.redirect(url);
        } else {
            this.serveRelease(req, res);
        }
    },
    downloadManifest: function (req, res) {
        var platform = req.params.platform = 'ios';
        var parsedBuild = this.parseBuildRequest(req, res);
        if (!parsedBuild) {
            return;
        }
        var build = parsedBuild.build;

        if (platform === 'ios') {
            var port = this.conf.proxyport || this.conf.uiport || this.conf.port;
            var baseURL = [
                this.conf.proxyprotocol || this.conf.serverprotocol || req.protocol && (req.protocol + '://') || 'http://',
                this.conf.proxy || this.conf.server,
                port !== 80 ? ':' : '',
                port !== 80 ? port : '',
                '/serve/',
                build.id,
                '/ios/'
            ].join('');
            var ipaPath = build.outputFiles.findOne(function (file) {
                return path.extname(file.file) === '.ipa';
            });
            ipaPath = ipaPath && ipaPath.file;
            var Info_plist = build.outputFiles.findOne(function (file) {
                return (/Info\.plist/i).test(path.basename(file.file));
            });
            var ipaFile = build.ipaFile || new IPAFile(ipaPath, Info_plist && Info_plist.file);
            build.ipaFile = ipaFile;
            var fileURL = baseURL + path.basename(ipaPath || 'application.ipa');
            var manifest = {
                fileURL: fileURL,
                displayImage: baseURL + '57.png',
                fullSizeImage: baseURL + '512.png',
                bundleIdentifier: ipaFile.id,
                subtitle: ipaFile.team,
                title: ipaFile.name
            };
            res.writeHead(200, {
                'Content-Type': 'application/xml',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': 0
            });
            mu.compileAndRender(__dirname + '/ipa/manifest.xml', manifest).pipe(res);
        }
    },
    serveRelease: function (req, res) {
        var buildRequest = this.parseBuildRequest(req, res);
        if (!buildRequest) {
            return;
        }
        var askForFile = req.params.file;
        var ipaPath = this.getIpaPath(buildRequest);

        if (buildRequest.platform === 'ios' && !ipaPath) {
            throw "cannot find any .ipa output files {0}".format(askForFile);
        }
        if (buildRequest.platform === 'ios' && askForFile && askForFile !== path.basename(ipaPath)) {
            var ipaFile = buildRequest.build.ipaFile || new IPAFile(ipaPath, this.getInfoPlist(buildRequest));
            buildRequest.build.ipaFile = ipaFile;
            switch (askForFile) {
                case '57.png':
                    res.writeHead(200, {'Content-Type': 'image/png'});
                    res.end(ipaFile.icon);
                    return;
                case '512.png':
                    res.writeHead(200, {'Content-Type': 'image/png'});
                    fs.createReadStream(path.resolve(__dirname, '/ipa/512.png')).pipe(res);
                    return;
                default:
                    res.send(500, 'There is no file with name {0} known for build {1}!'.format(askForFile, buildRequest.build.id));
                    return;
            }
        }

        res.setHeader('Content-disposition', 'attachment; filename=' + path.basename(ipaPath));
        res.setHeader('Content-type', this.mime_types[buildRequest.platform] || this.mime_types.ios);
        fs.createReadStream(ipaPath).pipe(res);
    },
    getIpaPath: function (buildRequest) {
        var exts = {android: '.apk', wp8: '.xap', ios: '.ipa'};
        var ipaPath = buildRequest.build.outputFiles.findOne(function (file) {
            return path.extname(file.file) === exts[buildRequest.platform];
        });
        return ipaPath && ipaPath.file;
    },
    getInfoPlist: function (buildRequest) {
        var Info_plist = buildRequest.build.outputFiles.findOne(function (file) {
            return (/Info\.plist/i).test(path.basename(file.file));
        });
        return Info_plist && Info_plist.file;
    },
    mime_types: {android: 'application/vnd.android.package-archive', wp8: 'application/x-silverlight-app', ios: 'application/octet-stream'},
    parseBuildRequest: function (req, res) {
        var buildId = req.params.id;
        var build = this.builds[buildId];
        if (!build || !build.conf) {
            return res.send(500, 'There is no built with id {0} to be found!'.format(buildId));
        }

        var platform = this.detectPlatform(build, req);
        var platformBuild;
        if (platform === 'autodetect') {
            return res.send(500, 'We could not detect your platform. Please download a specific platform from the nearby tabs!'.format(buildId));
        }

        var msg = null;
        if (build.master) {
            platformBuild = build.master.platforms.findOne(function (build) {
                return build && build.conf && build.conf.platform === platform;
            });
            msg = 'The specified build {0} was not requested on {1}!';

        } else {
            platformBuild = build.platforms && build.platforms.findOne(function (build) {
                return build && build.conf && build.conf.platform === platform;
            });

            msg = 'The build {0} contains no child builds on platform {1}!';
        }

        if (!platformBuild) {
            return res.send(500, msg.format(buildId, platform));
        }
        build = platformBuild;

        if (!build.conf || build.conf.status !== 'success') {
            return res.send(500, 'The build {0} has not completed successfully yet. Currently it is on status: {1}!'.format(buildId, build.conf.status));
        }

        if (!build.outputFiles || !build.outputFiles.length) {
            return res.send(500, 'There are no output files for the build {0}!'.format(buildId));
        }

        return {
            build: build,
            platform: platform
        };
    }
});
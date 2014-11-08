/**
 * @name BuildServer
 * @version 0.1
 * @fileoverview starts and handles the BuildServer
 */

var path = require('path');
var fs = require('fs-extra');
var io = require('socket.io');
var http = require('http');
var express = require('express');

/**
 * Constructor of UIServer
 * @class
 * @param {Object} conf      - configuration (console options)
 * @param {Cache}  cache     - cache object
 * @param {string} wwwFolder - path to the application's www folder
 */
function BuildServer(conf, cache, wwwFolder) {
    this.conf = conf;
    this.cache = cache;
    this.wwwFolder = wwwFolder;

    this.startHTTPServer();
}

/**
 * the buildserver's http server
 * @type {Object}
 */
BuildServer.prototype.httpServer = null;

/**
 * Initiates the http server with express
 */
BuildServer.prototype.startHTTPServer = function () {
    var buildServerApp = express();
    this.httpServer = http.createServer(buildServerApp);

    buildServerApp
        .get('/', this.handleRootRequest.bind(this))
        .use(express.static(this.wwwFolder));
};

/**
 * Responds with the processed server.html file
 * @param {Object} req - the request object
 * @param {Object} res - the response object
 */
BuildServer.prototype.handleRootRequest = function (req, res) {
    var conf = this.conf;
    var html = this.cache.get('server.html').replace('<script id="start"></script>', '<script id="start">var serverBrowser = new ServerBrowser({0});</script>'.format(JSON.stringify({
        protocol: conf.protocol,
        host: conf.server,
        port: conf.port
    })));
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
};

/**
 * Initiates socket
 * @return {Socket} - new socket object
 */
BuildServer.prototype.getSocket = function () {
    return io(this.httpServer, {
        'destroy buffer size': Infinity
    });
};

module.exports = BuildServer;
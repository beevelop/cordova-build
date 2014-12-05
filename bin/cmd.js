#!/usr/bin/env node

var extend = require('extend');
var cordovaBuild = require('../');
var conf = require('../lib/common/conf.js')();
var listen = conf.listen;

process.on('uncaughtException', function(err) {
    console.log('Uncaught Exception:');
    console.log(err);
    console.log(err.stack);
});

try {
    process.openStdin().on('keypress', function(chunk, key) {
        if (key && key.name === 'c' && key.ctrl) {
            process.emit('SIGINT');
            process.exit();
        }
    });

    if (process.platform === 'win32') {
        var readLine = require('readline');
        var rl = readLine.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.on('SIGINT', function() {
            process.emit('SIGINT');
        });
    }
} catch (e) {
    //@TODO: error-handling?
}

if (listen.server || listen.ui) {
    var server = conf.serverInstance = new cordovaBuild.Server(conf);
    server.init();
}

if (listen.agent) {
    var platforms = conf.agent.split(/,|;/g);
    var agents = [];
    platforms.forEach(function(platform) {
        var config = extend(true, {}, conf);
        config.agent = platform;
        var agent = new cordovaBuild.AgentWorker(config);
        agents.push(agent);
        agent.connect();
    });
}

if (listen.client) {
    var client = new cordovaBuild.ClientWorker(conf);
    client.connect();
}

if (listen.git) {
    var git = new cordovaBuild.GitServer(conf);
    git.init();
}
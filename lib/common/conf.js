require('./utils');
// patch on to support binding with multiple events at once
var patch = require('./patch');
patch(process.EventEmitter.prototype, ["on", "addListener"]);

var CommandLine = require('node-commandline').CommandLine;
var cmd = new CommandLine('node .\\server');
cmd.addArgument('protocol', {type: 'string'});
cmd.addArgument('server', {type: 'string'});
cmd.addArgument('port', {type: 'number'});
cmd.addArgument('proxy', {type: 'string'});
cmd.addArgument('proxyport', {type: 'number'});
cmd.addArgument('proxyprotocol', {type: 'string'});
cmd.addArgument('ui', {type: 'string'});
cmd.addArgument('uiprotocol', {type: 'string'});
cmd.addArgument('7zpath', {type: 'string'});
cmd.addArgument('mode', {
    type: 'string',
    required: true,
    allowedValues: ['server', 'client', 'agent', 'all', 'ui', 'git']
});
cmd.addArgument('keep', {type: 'number'});

try {
    var conf = cmd.parseNode.apply(cmd, process.argv);
} catch (e) {
    console.log(e);
    process.exit(2);
}

var listen = {};

/**
 * Server
 */
if (conf.mode === 'server' || conf.mode === 'all') {
    cmd.addArgument('location', {type: 'string'});
    listen.server = true;
}

/**
 * Git-Server
 */
if (conf.mode === 'git' || conf.mode === 'all') {
    cmd.addArgument('gitport', {type: 'number'});
    cmd.addArgument('gitconfig', {type: 'string'});
    cmd.addArgument('repos', {type: 'string'});
    cmd.addArgument('tmp', {type: 'string'});
    cmd.addArgument('key', {type: 'string'});
    cmd.addArgument('cert', {type: 'string'});
    listen.git = true;

    //@TODO: HTTPS (Certs)
    //@TODO: anonRead <boolean>
}

/**
 * Agent
 */
if (conf.mode === 'agent' || conf.mode === 'all' || conf.agent) {
    cmd.addArgument('agent', {type: 'string', required: true});
    cmd.addArgument('agentwork', {type: 'string', required: false});
    cmd.addArgument('agentname', {type: 'string', required: false});
    cmd.addArgument('reuseworkfolder', {type: 'boolean', required: false});
    if (conf.agent && conf.agent.indexOf && conf.agent.indexOf('android') >= 0) {
        cmd.addArgument('androidsdk', {type: 'string', required: false});
    }
    listen.agent = true;
}

/**
 * Client
 */
if (conf.mode === 'client' || conf.mode === 'all') {
    cmd.addArgument('platforms', {type: 'string', required: false});
    cmd.addArgument('files', {type: 'string', required: true});
    cmd.addArgument('build', {type: 'string', required: true});
    cmd.addArgument('number', {type: 'string', required: false});

    /* IOS specific arguments */
    if (conf.build && conf.build.indexOf && conf.build.indexOf('ios') >= 0) {
        if (!conf.iosskipsign) {
            if (!conf.iosprovisioningpath) {
                throw new Error('-iosprovisioningpath:"path-to-your-provision-file.mobileprovision" was not being specified!');
            }
            if (!conf.ioscodesignidentity) {
                throw new Error('-ioscodesignidentity:"your-provision-name" was not being specified!');
            }

            cmd.addArgument('iosprovisioningpath', {type: 'string', required: true});
            cmd.addArgument('ioscodesignidentity', {type: 'string', required: true});
            cmd.addArgument('iosmanifesturl', {
                type: 'string',
                required: false,
                example: "https://domain.co.uk/download.aspx?name=Info.plist&url={0}"
            });
        }

        cmd.addArgument('ios', {type: 'string', required: false});
        //cmd.addArgument('iossignonly', { type: 'boolean', required: false});
    }

    /* Android specific arguments */
    if (conf.build && conf.build.indexOf && conf.build.indexOf('android') >= 0) {
        cmd.addArgument('androidsign', {type: 'string', required: false});
        cmd.addArgument('android', {type: 'string', required: false});
    }

    /* WP8 specific arguments */
    if (conf.build && conf.build.indexOf && conf.build.indexOf('wp8') >= 0) {
        cmd.addArgument('wp8', {type: 'string', required: false});
    }

    listen.client = true;
}

/**
 * UI
 */
if (conf.mode === 'ui' || conf.mode === 'server' || conf.mode === 'all') {
    cmd.addArgument('uiport', {type: 'number', required: false});
    listen.ui = true;
}

function parseArgs() {
    try {
        conf = cmd.parseNode.apply(cmd, process.argv);
    } catch (e) {
        console.log(e);
        process.exit(1);
    }

    /* Set defaults */
    conf.protocol = conf.protocol || 'http://';
    conf.port = conf.port || 8300;
    conf.server = conf.server || 'localhost';
    conf.url = '{0}{1}{2}'.format(conf.protocol, conf.server, conf.port === 80 ? '' : ':' + conf.port);

    conf.listen = listen;
    conf.platforms = (conf.build || 'wp8,android,ios').split(/;|,/g);
    conf.build = (conf.build || 'ios,android,wp8').split(/,|;/g);
    conf.wp8 = (conf.wp8 || '').split(/;|,/g);
    conf.android = (conf.android || '').split(/;|,/g);
    conf.ios = (conf.ios || '').split(/;|,/g);
    conf.files = (conf.files || '').split(/;|,/g);
    conf.keep = conf.keep || 0;

    return conf;
}

module.exports = parseArgs;
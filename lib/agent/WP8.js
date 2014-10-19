/**
 * @name WP8
 * @version 0.1
 * @fileoverview contains WP8's specific build processes
 *                 mainly hooks into {@link GenericBuild}'s callbacks
 */

var GenericBuild = require('./GenericBuild');

/**
 * Constructor of the wp8 build sequence
 *
 * @class
 * @param {Build} build - reference to the build object
 * @param {Agent} agent - reference to the agent
 */
function WP8(build, agent) {
    this.build = build;
    this.agent = agent;
}

/**
 * Initiate the Agent's generic Build if everthing went right
 */
WP8.prototype.init = function () {
    var _genericBuild = new GenericBuild(this.build, this.agent);
    _genericBuild.setHook('buildDone', this.buildDone.bind(this));
    _genericBuild.launch();
};

/**
 * Hook into the {@link GenericBuild}'s buildDone callback
 *
 * @param {Object} [err] - error object (looping asynchronously through APKS failed) or null
 */
WP8.prototype.buildDone = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (!err) {
        this.agent.buildSuccess(this.build, ['platforms/wp8/**/*.xap', 'build.wp8.log']);
    }
    //@TODO: what if err?
};

module.exports = WP8;
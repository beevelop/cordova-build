module.exports = WP8;

function WP8(build, agent) {
    this.build = build;
    this.agent = agent;
}

WP8.define({
    /* 0.) Initiate building sequence */
    init: function() {
        this.agent.genericBuild(this.build, null, this.buildDone);
    },
    /* 1.) Hook into buildDone */
    buildDone: function(err) {
        if (this.build.conf.status === 'cancelled') {
            return;
        }
        if (!err) {
            this.agent.buildSuccess(this.build, ['platforms/wp8/**/*.xap', 'build.wp8.log']);
        }
        //@TODO: what if err?
    }
});
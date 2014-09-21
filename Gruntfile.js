module.exports = function (grunt) {

    grunt.initConfig({
        jshint: {
            all: ['Gruntfile.js', 'lib/**/*.js']
        },
        browserify: {
            all: {
                src: "www/js/index.js",
                dest: "www/js/bundle.js"
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-browserify');
    
    grunt.registerTask('default', 'jshint');
    grunt.registerTask('bundle', 'browserify');
};
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
        },
        jsdoc: {
            dist: {
                src: ['lib/**/*.js'],
                options: {
                    destination: 'docs',
                    tutorials: 'tuts'
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-browserify');
    grunt.loadNpmTasks('grunt-jsdoc');

    grunt.registerTask('default', 'jshint');
    grunt.registerTask('bundle', 'browserify');
    grunt.registerTask('docs', 'jsdoc');
};
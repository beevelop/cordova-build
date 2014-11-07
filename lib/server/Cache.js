/**
 * @name Cache
 * @version 0.1
 * @fileoverview provides asynchronous caching to {@link BuildServer} and {@link UIServer}
 */

var fs = require('fs-extra');
var events = require('events');

/**
 * Constructor of Cache
 * @class
 */
function Cache(wwwFolder) {
    this.cache = [];
    this.wwwFolder = wwwFolder;
}

/**
 * Cache extends from EventEmitter
 */
Cache.prototype = new events.EventEmitter();

/**
 * the files' encoding
 * @type {string}
 */
Cache.prototype.encoding = 'utf-8';

/**
 * Gets the requested cache
 * @param key
 * @returns {string|Array} cache content or empty string
 */
Cache.prototype.get = function (key) {
    if (!key) {
        return this.cache;
    }
    return this.cache[key] || '';
};

/**
 * Watch for file changes and request cache update on change
 * @param {string} file - absolute path to the file
 */
Cache.prototype.addFile = function (file, key) {
    var lastTime = new Date();
    this.cacheFile(file, key);

    var _self = this;
    fs.watch(file, function () {
        if (lastTime < new Date()) {
            lastTime = new Date(new Date().getTime() + 500); //500ms threshold to avoid duplicates on windows
            setTimeout(function () {
                _self.cacheFile(file, key, true);
            }, 100);
        }
    });
};

/**
 * Read file and cache filecontents
 * triggers GUI reload on asynchronous read
 * @param {string}  file    - filepath
 * @param {boolean} [async] - reads file asynchronous if set
 */
Cache.prototype.cacheFile = function (file, key, async) {
    if (async) {
        var _self = this;
        fs.readFile(file, {
            encoding: this.encoding
        }, function (err, content) {
            _self.cache[key] = err || content;
            _self.emit('updated');
        });
    } else {
        this.cache[key] = fs.readFileSync(file, {
            encoding: this.encoding
        });
    }
};

module.exports = Cache;
/*
 * adapted from ipaserver
 * https://github.com/operandom/ipaserver
 *
 * Copyright (c) 2013 Valéry Herlaud
 * Licensed under the MIT license.
 */
var util = require('util');
var typer = require('proto-typer');
var EventEmitter = require('events').EventEmitter;
var AdmZip = require('adm-zip');
var fs = require('fs-extra');

function IPAFile(path, InfoPlist) {
    this.InfoPlist = InfoPlist;
    if (path) {
        this.path = path;
    }
}

function getKey(target, key) {
    var pattern = key + '(.|[\r\n])+?string>(.*)?(?=</string>)';
    var string;

    var matches = target.match(new RegExp(pattern));

    if (matches && matches.length > 0) {
        string = matches[2];
    } else {
        string = 'Not find';
    }
    return string;
}

///////////////////
//               //
//    PARSING    //
//               //
///////////////////
function startParsing(target) {

    var file = target.file,
            entries = file.getEntries(),
            nbrEntries = entries.length,
            keys = {
                'name': 'CFBundleDisplayName',
                'version': 'CFBundleVersion',
                'id': 'CFBundleIdentifier',
                'team': 'TeamName'
            },
            foundInfo,
            foundProvision,
            foundIcon;

    for (var i = 0; i < nbrEntries; i++) {
        var entry = entries[i];
        var data;

        if (!foundInfo && entry.entryName.match(/Info\.plist$/)) {
            foundInfo = true;
            data = target.InfoPlist ? fs.readFileSync(target.InfoPlist, 'UTF-8') : file.readAsText(entry);
            target.name = getKey(data, keys.name);
            target.version = getKey(data, keys.version);
            target.id = getKey(data, keys.id);
        }

        if (!foundProvision && entry.entryName.match(/embedded\.mobileprovision$/)) {
            foundProvision = true;
            data = file.readAsText(entry);
            target.team = getKey(data, keys.team);
        }

        if (!foundIcon && entry.entryName.match(/Icon\.png$/i)) {
            foundIcon = true;
            data = file.readFile(entry);
            target.icon = data;
        }

        if (foundInfo && foundProvision && foundIcon) {
            break;
        }
    }
}

/////////////////////////////
//                         //
//    SETTERS & GETTERS    //
//                         //
/////////////////////////////
function getPathAccessors() {
    return {
        'enumerable': true,
        'get': function() {
            return this._path;
        },
        'set': function(value) {
            if (this._path !== value) {
                var oldValue = this._path;
                this._path = value;
                this.file = new AdmZip(value);
                this.emit('propertyChange', {
                    'type': 'propertyChange',
                    'target': this,
                    'property': 'path',
                    'oldValue': oldValue,
                    'newValue': value
                });
            }
        }
    };
}

function getFileAccessors() {
    return {
        'enumerable': true,
        'get': function() {
            return this._file;
        },
        'set': function(value) {
            if (this._file !== value) {
                this._file = value;
                startParsing(this);
            }
        }
    };
}

function define() {
    util.inherits(IPAFile, EventEmitter);

    return typer.define(IPAFile.prototype)
        .p('_path').nk.f
        .u('path', getPathAccessors)
        .p('_file').nk.f
        .u('file', getFileAccessors)
        .p('name').t(String).e().f
        .p('version').t(String).e().f
        .p('id').t(String).e().f
        .p('team').t(String).e().f
        .p('icon').e().f;
}

module.exports = (function() {
    define();
    return IPAFile;
}());
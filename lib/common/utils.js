var log = console.log;
var stringformat = require('stringformat');

require('date-format-lite');
require('array-sugar');

stringformat.extendString();

if (typeof window !== 'undefined') {
    window.global = window;
}
Date.prototype.elapsed = function (until) {
    var Elapsed = require('elapsed');
    return new Elapsed(this, until).optimal;
};

console.log = function () {
    Array.prototype.unshift.call(arguments, new Date().format("hh:mm:ss.SS"));
    log.apply(this, arguments);
}.bind(console);

Object.each = function (obj, callback, context) {
    var value,
        i = 0,
        length = obj.length,
        type = jQuery.type(obj),
        isArray = type === "array" || type !== "function" && (length === 0 || typeof length === "number" && length > 0 && (length - 1) in obj);

    if (context) {
        if (isArray) {
            obj.forEach(callback, context);
        } else {
            for (i in obj) {
                if (obj.hasOwnProperty(i)) {
                    value = callback.call(context, obj[i], i, obj);
                    if (value === false) {
                        break;
                    }
                }
            }
        }
    } else {
        if (isArray) {
            obj.forEach(callback, obj);
        } else {
            for (i in obj) {
                if (obj.hasOwnProperty(i)) {
                    value = callback.call(obj, i, obj[i], i, obj);
                    if (value === false) {
                        break;
                    }
                }
            }
        }
    }
    return obj;
};

var class2type = [];
"Boolean Number String Function Array Date RegExp Object Error".split(" ").forEach(function (name) {
    class2type["[object " + name + "]"] = name.toLowerCase();
});
Object.every = function (obj, callback, context) {
    var value,
        i = 0,
        length = obj.length,
        type = obj === null ? String(obj) : typeof obj === "object" || typeof obj === "function" ? class2type[class2type.toString.call(obj)] || "object" : typeof obj,
        isArray = type === "array" || type !== "function" && (length === 0 || typeof length === "number" && length > 0 && (length - 1) in obj);

    if (context) {
        if (isArray) {
            obj.every(callback, context);
        } else {
            for (i in obj) {
                if (obj.hasOwnProperty(i)) {
                    value = callback.call(context, obj[i], i, obj);
                    if (value === false) {
                        return false;
                    }
                }
            }
        }
    } else {
        if (isArray) {
            obj.every(callback, obj);
        } else {
            for (i in obj) {
                if (obj.hasOwnProperty(i)) {
                    value = callback.call(obj, i, obj[i], i, obj);
                    if (value === false) {
                        return false;
                    }
                }
            }
        }
    }
    return true;
};

var splice = Array.prototype.splice;
var bind = Function.prototype.bind || (Function.prototype.bind = function (oThis, args) {
        var aArgs = Array.prototype.slice.call(arguments, 1), fToBind = this, fNOP = function () {
        }, fBound = function () {
            return fToBind.apply(this instanceof fNOP && oThis ? this : oThis, aArgs.concat(Array.prototype.slice.call(arguments)));
        };
        fNOP.prototype = this.prototype;
        fBound.prototype = new fNOP();
        return fBound;
    });

var defineProperties = Object.defineProperties || (Object.defineProperties = function defineProperties(obj, properties) {
        function convertToDescriptor(desc) {
            function hasProperty(obj, prop) {
                return Object.prototype.hasOwnProperty.call(obj, prop);
            }

            function isCallable(v) {
                // NB: modify as necessary if other values than functions are callable.
                return typeof v === "function";
            }

            if (typeof desc !== "object" || desc === null)
                throw new TypeError("bad desc");

            var d = {};

            if (hasProperty(desc, "enumerable"))
                d.enumerable = !!obj.enumerable;
            if (hasProperty(desc, "configurable"))
                d.configurable = !!obj.configurable;
            if (hasProperty(desc, "value"))
                d.value = obj.value;
            if (hasProperty(desc, "writable"))
                d.writable = !!desc.writable;
            if (hasProperty(desc, "get")) {
                var g = desc.get;

                if (!isCallable(g) && typeof g !== "undefined")
                    throw new TypeError("bad get");
                d.get = g;
            }
            if (hasProperty(desc, "set")) {
                var s = desc.set;
                if (!isCallable(s) && typeof s !== "undefined")
                    throw new TypeError("bad set");
                d.set = s;
            }

            if (("get" in d || "set" in d) && ("value" in d || "writable" in d))
                throw new TypeError("identity-confused descriptor");

            return d;
        }

        if (typeof obj !== "object" || obj === null)
            throw new TypeError("bad obj");

        properties = Object(properties);

        var keys = Object.keys(properties);
        var descs = [];

        for (var i = 0; i < keys.length; i++)
            descs.push([keys[i], convertToDescriptor(properties[keys[i]])]);

        for (var i = 0; i < descs.length; i++)
            Object.defineProperty(obj, descs[i][0], descs[i][1]);

        return obj;
    });

defineProperties(Function.prototype, {
    'defer': {
        enumerable: false, configurable: true, value: function (timeout, thisArg, arg1, arg2, arg3) {
            var t = timeout || 0;
            if (t < 0) {
                return this.apply(thisArg, splice.call(arguments, 0, 2) && arguments) && 0 || 0;
            }
            return setTimeout(bind.apply(this, splice.call(arguments, 0, 1) && arguments), t);
        }
    },
    'deferApply': {
        enumerable: false, configurable: true, value: function (timeout, thisArg, argsArray) {
            if ((timeout || 0) < 0) {
                return this.apply(thisArg, argsArray || []) && 0 || 0;
            }
            return setTimeout(bind.apply(this, splice.call(argsArray = argsArray || [], 0, 0, thisArg) && argsArray), timeout);
        }
    },
    'bindDefer': {
        enumerable: false, configurable: true, value: function (timeout, thisArg, arg1, arg2, arg3) {
            return bind.apply(this.defer, splice.call(arguments, 0, 0, this) && arguments);
        }
    },
    'bindDeferApply': {
        enumerable: false, configurable: true, value: function (timeout, thisArg, argsArray) {
            return bind.apply(this.defer, splice.apply(arguments, splice.call(argsArray = argsArray || [], 0, 0, 0, 3, this, timeout, thisArg) && argsArray) && arguments);
        }
    }
});
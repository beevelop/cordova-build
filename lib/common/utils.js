var log = console.log;
require('date-format-lite');
require('fast-class');
require('array-sugar');
var Elapsed = require('elapsed');

if (typeof window !== 'undefined') {
    window.global = window;
}
Date.prototype.elapsed = function(until) {
    return new Elapsed(this, until).optimal;
};

console.log = function() {
    Array.prototype.unshift.call(arguments, new Date().format("hh:mm:ss.SS"));
    log.apply(this, arguments);
}.bind(console);

var class2type = [];
"Boolean Number String Function Array Date RegExp Object Error".split(" ").forEach(function(name) {
    class2type["[object " + name + "]"] = name.toLowerCase();
});

Object.each = function(obj, callback, context) {
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
                value = callback.call(context, obj[i], i, obj);
                if (value === false) {
                    break;
                }
            }
        }
    } else {
        if (isArray) {
            obj.forEach(callback, obj);
        } else {
            for (i in obj) {
                value = callback.call(obj, i, obj[i], i, obj);
                if (value === false) {
                    break;
                }
            }
        }
    }
    return obj;
};

Object.every = function(obj, callback, context) {
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
                value = callback.call(context, obj[i], i, obj);
                if (value === false) {
                    return false;
                }
            }
        }
    } else {
        if (isArray) {
            obj.every(callback, obj);
        } else {
            for (i in obj) {
                value = callback.call(obj, i, obj[i], i, obj);
                if (value === false) {
                    return false;
                }
            }
        }
    }
    return true;
};

var splice = Array.prototype.splice;
var defineProperties = Object.defineProperties || (Object.defineProperties = function(obj, props) {
    for (var i in props) {
        obj[i] = props.value;
    }
});
var bind = Function.prototype.bind || (Function.prototype.bind = function(oThis, args) {
    var aArgs = Array.prototype.slice.call(arguments, 1), fToBind = this, fNOP = function() {
    }, fBound = function() {
        return fToBind.apply(this instanceof fNOP && oThis ? this : oThis, aArgs.concat(Array.prototype.slice.call(arguments)));
    };
    fNOP.prototype = this.prototype;
    fBound.prototype = new fNOP();
    return fBound;
});

defineProperties(Function.prototype, {
    'defer': {
        enumerable: false, configurable: true, value: function(timeout, thisArg, arg1, arg2, arg3) {
            var t = timeout || 0;
            if (t < 0) {
                return this.apply(thisArg, splice.call(arguments, 0, 2) && arguments) && 0 || 0;
            }
            return setTimeout(bind.apply(this, splice.call(arguments, 0, 1) && arguments), t);
        }
    },
    'deferApply': {
        enumerable: false, configurable: true, value: function(timeout, thisArg, argsArray) {
            if ((timeout || 0) < 0) {
                return this.apply(thisArg, argsArray || []) && 0 || 0;
            }
            return setTimeout(bind.apply(this, splice.call(argsArray = argsArray || [], 0, 0, thisArg) && argsArray), timeout);
        }
    },
    'bindDefer': {
        enumerable: false, configurable: true, value: function(timeout, thisArg, arg1, arg2, arg3) {
            return bind.apply(this.defer, splice.call(arguments, 0, 0, this) && arguments);
        }
    },
    'bindDeferApply': {
        enumerable: false, configurable: true, value: function(timeout, thisArg, argsArray) {
            return bind.apply(this.defer, splice.apply(arguments, splice.call(argsArray = argsArray || [], 0, 0, 0, 3, this, timeout, thisArg) && argsArray) && arguments);
        }
    }
});
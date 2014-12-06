function BrowserDetect(userAgent) {
    this.userAgent = userAgent || '';
}

BrowserDetect.prototype.android = function () {
    return this.userAgent.match(/Android/i);
};

BrowserDetect.prototype.blackBerry = function () {
    return this.userAgent.match(/BlackBerry/i);
};

BrowserDetect.prototype.iOS = function () {
    return this.userAgent.match(/iPhone|iPad|iPod/i);
};

BrowserDetect.prototype.opera = function () {
    return this.userAgent.match(/Opera Mini/i);
};

BrowserDetect.prototype.windows = function () {
    return this.userAgent.match(/IEMobile/i);
};

BrowserDetect.prototype.any = function () {
    return (this.isMobile.android() || this.blackBerry() || this.iOS() || this.opera() || this.windows());
};

module.exports = BrowserDetect;
"use strict";
exports.__esModule = true;
exports.openPdf = exports.Reader = void 0;
var child_process_1 = require("child_process");
var Reader;
(function (Reader) {
    Reader["Preview"] = "Preview";
    Reader["Acrobat"] = "Adobe Acrobat";
    Reader["AcrobatReader"] = "Adobe Acrobat Reader DC";
    Reader["Foxit"] = "Foxit Reader";
    Reader["Chrome"] = "Google Chrome";
    Reader["Firefox"] = "Firefox";
})(Reader = exports.Reader || (exports.Reader = {}));
var openPdf = function (path, reader) {
    if (reader === void 0) { reader = Reader.Preview; }
    if (process.platform === 'darwin') {
        (0, child_process_1.execSync)("open -a \"".concat(reader, "\" ").concat(path));
    }
    else {
        var msg1 = "Note: Automatically opening PDFs currently only works on Macs. If you're using a Windows or Linux machine, please consider contributing to expand support for this feature";
        var msg2 = "(https://github.com/Hopding/pdf-lib/blob/master/apps/node/index.ts#L8-L17)\n";
        console.warn(msg1);
        console.warn(msg2);
    }
};
exports.openPdf = openPdf;

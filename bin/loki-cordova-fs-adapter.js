"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var LokiCordovaFSAdapterError = function (_Error) {
    _inherits(LokiCordovaFSAdapterError, _Error);

    function LokiCordovaFSAdapterError() {
        _classCallCheck(this, LokiCordovaFSAdapterError);

        return _possibleConstructorReturn(this, (LokiCordovaFSAdapterError.__proto__ || Object.getPrototypeOf(LokiCordovaFSAdapterError)).apply(this, arguments));
    }

    return LokiCordovaFSAdapterError;
}(Error);

var TAG = "[LokiCordovaFSAdapter]";

var LokiCordovaFSAdapter = function () {
    function LokiCordovaFSAdapter(options) {
        _classCallCheck(this, LokiCordovaFSAdapter);

        this.options = options;
        this.queuesRunning = new Array();
        this.saveDbQueue = {};
    }

    _createClass(LokiCordovaFSAdapter, [{
        key: "runDbQueue",
        value: function runDbQueue(dbname) {
            var _this2 = this;

            if (!this.saveDbQueue.hasOwnProperty(dbname)) {
                this.stopDbQueue(dbname);
                return;
            }

            // Lancia la coda solo se ci sono salvataggi da effettuare
            var dbQueue = this.saveDbQueue[dbname];
            if (dbQueue.length < 1) {
                this.stopDbQueue(dbname);
                return;
            }

            // Salvataggio del primo elemento in lista (coda fifo)
            var saveData = this.saveDbQueue[dbname].splice(0, 1);
            saveData = saveData[0];

            var adapterRef = this;

            this._getFile(dbname, function (fileEntry) {
                fileEntry.createWriter(function (fileWriter) {
                    // Handle write error
                    fileWriter.onwrite = function () {
                        if (fileWriter.length > 0) {
                            console.error(TAG, "error writing file, LENGHT: " + fileWriter.length);
                            var saveErr = new LokiCordovaFSAdapterError("Unable to truncate file, LENGHT: " + fileWriter.length);
                            saveData.callback(saveErr);
                            adapterRef.runDbQueue(dbname);
                            return;
                        }

                        // Callback finale - così è dichiarata correttamente
                        fileWriter.onwrite = function () {
                            saveData.callback();
                            adapterRef.runDbQueue(dbname);
                        };

                        var blob = _this2._createBlob(saveData.dbstring, "text/plain");
                        fileWriter.write(blob);
                    };

                    fileWriter.onerror = function (err) {
                        console.error(TAG, "error writing file", err, fileWriter.err);
                        var saveErr = new LokiCordovaFSAdapterError("Unable to write file" + JSON.stringify(err) + ' - internal error: ' + JSON.stringify(fileWriter.error));
                        saveData.callback(saveErr);
                        adapterRef.runDbQueue(dbname);
                    };

                    fileWriter.truncate(0);
                }, function (err) {
                    console.error(TAG, "error writing file", err);
                    var saveErr = new LokiCordovaFSAdapterError("Unable to write file" + JSON.stringify(err));
                    saveData.callback(saveErr);
                    adapterRef.runDbQueue(dbname);
                });
            }, function (err) {
                console.error(TAG, "error getting file", err);
                var saveErr = new LokiCordovaFSAdapterError("Unable to get file" + JSON.stringify(err));
                saveData.callback(saveErr);
                adapterRef.runDbQueue(dbname);
            });
        }
    }, {
        key: "saveDatabase",
        value: function saveDatabase(dbname, dbstring, callback) {
            console.log(TAG, "saving database");

            //--Rut - 09/11/2016 - gestione salvataggi con una coda - se ne porta a termine solo uno alla volta per non far
            // accavallare molte callback concorrenti
            if (!this.saveDbQueue.hasOwnProperty(dbname)) {
                this.saveDbQueue[dbname] = new Array();
            }

            this.saveDbQueue[dbname].push({ dbstring: dbstring, callback: callback });

            if (this.queuesRunning.indexOf(dbname) < 0) {
                this.queuesRunning.push(dbname);
                this.runDbQueue(dbname);
            }
        }
    }, {
        key: "loadDatabase",
        value: function loadDatabase(dbname, callback) {
            console.log(TAG, "loading database");
            this._getFile(dbname, function (fileEntry) {
                fileEntry.file(function (file) {
                    var reader = new FileReader();
                    reader.onloadend = function (event) {
                        var contents = event.target.result;
                        if (contents.length === 0) {
                            console.warn(TAG, "couldn't find database");
                            callback(null);
                        } else {
                            callback(contents);
                        }
                    };
                    reader.readAsText(file);
                }, function (err) {
                    console.error(TAG, "error reading file", err);
                    callback(new LokiCordovaFSAdapterError("Unable to read file" + err.message));
                });
            }, function (err) {
                console.error(TAG, "error getting file", err);
                callback(new LokiCordovaFSAdapterError("Unable to get file: " + err.message));
            });
        }
    }, {
        key: "deleteDatabase",
        value: function deleteDatabase(dbname, callback) {
            var _this3 = this;

            window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function (dir) {
                var fileName = _this3.options.prefix + "__" + dbname;
                dir.getFile(fileName, { create: true }, function (fileEntry) {
                    fileEntry.remove(function () {
                        callback();
                    }, function (err) {
                        console.error(TAG, "error delete file", err);
                        throw new LokiCordovaFSAdapterError("Unable delete file" + JSON.stringify(err));
                    });
                }, function (err) {
                    console.error(TAG, "error delete database", err);
                    throw new LokiCordovaFSAdapterError("Unable delete database" + JSON.stringify(err));
                });
            }, function (err) {
                throw new LokiCordovaFSAdapterError("Unable to resolve local file system URL" + JSON.stringify(err));
            });
        }
    }, {
        key: "stopDbQueue",
        value: function stopDbQueue(dbname) {
            var dbQueueIndex = this.queuesRunning.indexOf(dbname);
            if (dbQueueIndex > -1) {
                this.queuesRunning.splice(dbQueueIndex, 1);
            }
        }
    }, {
        key: "_getFile",
        value: function _getFile(name, handleSuccess, handleError) {
            var _this4 = this;

            window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function (dir) {
                var fileName = _this4.options.prefix + "__" + name;
                dir.getFile(fileName, { create: true }, handleSuccess, handleError);
            }, function (err) {
                throw new LokiCordovaFSAdapterError("Unable to resolve local file system URL" + JSON.stringify(err));
            });
        }

        // adapted from http://stackoverflow.com/questions/15293694/blob-constructor-browser-compatibility

    }, {
        key: "_createBlob",
        value: function _createBlob(data, datatype) {
            var blob = void 0;

            try {
                blob = new Blob([data], { type: datatype });
            } catch (err) {
                window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;

                if (err.name === "TypeError" && window.BlobBuilder) {
                    var bb = new window.BlobBuilder();
                    bb.append(data);
                    blob = bb.getBlob(datatype);
                } else if (err.name === "InvalidStateError") {
                    // InvalidStateError (tested on FF13 WinXP)
                    blob = new Blob([data], { type: datatype });
                } else {
                    // We're screwed, blob constructor unsupported entirely
                    throw new LokiCordovaFSAdapterError("Unable to create blob" + JSON.stringify(err));
                }
            }
            return blob;
        }
    }]);

    return LokiCordovaFSAdapter;
}();

module.exports = LokiCordovaFSAdapter;
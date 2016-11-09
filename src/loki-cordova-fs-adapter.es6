class LokiCordovaFSAdapterError extends Error {}

const TAG = "[LokiCordovaFSAdapter]";

class LokiCordovaFSAdapter {
    constructor(options) {
        this.options = options;
        this.queuesRunning = new Array();
        this.saveDbQueue = {};
    }

    runDbQueue(dbname){
        if(!this.saveDbQueue.hasOwnProperty(dbname)){
            this.stopDbQueue(dbname);
            return;
        }

        // Lancia la coda solo se ci sono salvataggi da effettuare
        var dbQueue = this.saveDbQueue[dbname];
        if(dbQueue.length < 1){
            this.stopDbQueue(dbname);
            return;
        }

        // Salvataggio del primo elemento in lista (coda fifo)
        var saveData = this.saveDbQueue[dbname].splice(0, 1);
        saveData = saveData[0];

        var adapterRef = this;

        this._getFile(dbname,
            (fileEntry) => {
                fileEntry.createWriter(
                    (fileWriter) => {
                        // Handle write error
                        fileWriter.onwrite = () => {
                            if (fileWriter.length > 0) {
                                console.error(TAG, "error writing file, LENGHT: " + fileWriter.length);
                                var saveErr =  new LokiCordovaFSAdapterError("Unable to truncate file, LENGHT: " + fileWriter.length);
                                saveData.callback(saveErr);
                                adapterRef.runDbQueue(dbname);
                                return;
                            }

                            // Callback finale - così è dichiarata correttamente
                            fileWriter.onwrite = () => {
                                saveData.callback();
                                adapterRef.runDbQueue(dbname);
                            };

                            var blob = this._createBlob(saveData.dbstring, "text/plain");
                            fileWriter.write(blob);
                        };

                        fileWriter.onerror = (err) => {
                            console.error(TAG, "error writing file", err, fileWriter.err);
                            var saveErr = new LokiCordovaFSAdapterError("Unable to write file" + JSON.stringify(err) + ' - internal error: ' + JSON.stringify(fileWriter.error));
                            saveData.callback(saveErr);
                            adapterRef.runDbQueue(dbname);
                        };

                        fileWriter.truncate(0);
                    },
                    (err) => {
                        console.error(TAG, "error writing file", err);
                        var saveErr = new LokiCordovaFSAdapterError("Unable to write file" + JSON.stringify(err));
                        saveData.callback(saveErr);
                        adapterRef.runDbQueue(dbname);
                    }
                );
            },
            (err) => {
                console.error(TAG, "error getting file", err);
                var saveErr = new LokiCordovaFSAdapterError("Unable to get file" + JSON.stringify(err));
                saveData.callback(saveErr);
                adapterRef.runDbQueue(dbname);
            }
        );
    }

    saveDatabase(dbname, dbstring, callback) {
        console.log(TAG, "saving database");

        //--Rut - 09/11/2016 - gestione salvataggi con una coda - se ne porta a termine solo uno alla volta per non far
        // accavallare molte callback concorrenti
        if(!this.saveDbQueue.hasOwnProperty(dbname)){
            this.saveDbQueue[dbname] = new Array();
        }

        this.saveDbQueue[dbname].push({dbstring: dbstring, callback: callback});

        if(this.queuesRunning.indexOf(dbname) < 0){
            this.queuesRunning.push(dbname);
            this.runDbQueue(dbname);
        }

    }

    loadDatabase(dbname, callback) {
        console.log(TAG, "loading database");
        this._getFile(dbname,
            (fileEntry) => {
                fileEntry.file((file) => {
                    var reader = new FileReader();
                    reader.onloadend = (event) => {
                        var contents = event.target.result;
                        if (contents.length === 0) {
                            console.warn(TAG, "couldn't find database");
                            callback(null);
                        }
                        else {
                            callback(contents);
                        }
                    };
                    reader.readAsText(file);
                }, (err) => {
                    console.error(TAG, "error reading file", err);
                    callback(new LokiCordovaFSAdapterError("Unable to read file" + err.message));
                });
            },
            (err) => {
                console.error(TAG, "error getting file", err);
                callback(new LokiCordovaFSAdapterError("Unable to get file: " + err.message));
            }
        );
    }
    
    deleteDatabase(dbname, callback) {
        window.resolveLocalFileSystemURL(cordova.file.dataDirectory,
            (dir) => {
                let fileName = this.options.prefix + "__" + dbname;
                dir.getFile(fileName, {create: true}, 
                    (fileEntry) => {
                        fileEntry.remove(
                            () => {
                                callback();
                            },
                            (err) => {
                                console.error(TAG, "error delete file", err);
                                throw new LokiCordovaFSAdapterError("Unable delete file" + JSON.stringify(err));
                            }
                        );
                    },
                    (err) => {
                        console.error(TAG, "error delete database", err);
                        throw new LokiCordovaFSAdapterError(
                            "Unable delete database" + JSON.stringify(err)
                        );
                    }
                );
            },
            (err) => {
                throw new LokiCordovaFSAdapterError(
                    "Unable to resolve local file system URL" + JSON.stringify(err)
                );
            }
        );
    }

    stopDbQueue(dbname){
        var dbQueueIndex = this.queuesRunning.indexOf(dbname);
        if(dbQueueIndex > -1){
            this.queuesRunning.splice(dbQueueIndex, 1);
        }
    }

    _getFile(name, handleSuccess, handleError) {
        window.resolveLocalFileSystemURL(cordova.file.dataDirectory,
            (dir) => {
                let fileName = this.options.prefix + "__" + name;
                dir.getFile(fileName, {create: true}, handleSuccess, handleError);
            },
            (err) => {
                throw new LokiCordovaFSAdapterError(
                    "Unable to resolve local file system URL" + JSON.stringify(err)
                );
            }
        );
    }

    // adapted from http://stackoverflow.com/questions/15293694/blob-constructor-browser-compatibility
    _createBlob(data, datatype) {
        let blob;

        try {
            blob = new Blob([data], {type: datatype});
        }
        catch (err) {
            window.BlobBuilder = window.BlobBuilder ||
                    window.WebKitBlobBuilder ||
                    window.MozBlobBuilder ||
                    window.MSBlobBuilder;

            if (err.name === "TypeError" && window.BlobBuilder) {
                var bb = new window.BlobBuilder();
                bb.append(data);
                blob = bb.getBlob(datatype);
            }
            else if (err.name === "InvalidStateError") {
                // InvalidStateError (tested on FF13 WinXP)
                blob = new Blob([data], {type: datatype});
            }
            else {
                // We're screwed, blob constructor unsupported entirely
                throw new LokiCordovaFSAdapterError(
                    "Unable to create blob" + JSON.stringify(err)
                );
            }
        }
        return blob;
    }
}


export default LokiCordovaFSAdapter;

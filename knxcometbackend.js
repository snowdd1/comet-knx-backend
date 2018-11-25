/* jshint esversion: 6, strict: true, node: true */

'use strict';


/* *********
 * Plan: 
 * 
 * (done) connect to eibd
 * (done) get all raw telegrams
 * (done) store all values in a key-value store (aka object, dictionary etc.)
 * (done) provide a read hook (http/https) using SSE (simple sample https://www.w3schools.com/html/html5_serversentevents.asp )
 * (done) provide a write hook (dito) - 
 * (done) provide a login hook (dito) https://github.com/CometVisu/CometVisu/wiki/Protokoll#login resp https://knx-user-forum.de/forum/supportforen/cometvisu/1288069-noch-eine-knxd-auf-zweitem-server?p=1288496#post1288496
 * (done) issue read requests for values not in the cache (might be dangerous?)
 * Pending:
 * - find out why the node-eibd requires to close the connection after each telegram for reliable sending of telegrams.
 * - 
 *
 */

/**
 * Configuration Object
 * */

var indGroupReader = 0;

/**
 * @type {{Info: Integer, Debug: Integer, Warning: Integer, Error: Integer}}
 * */
const loglevels = { Info: 3, Debug: 4, Warning: 2, Error: 1 }

/**
 * @classdesc Microscopic Debugging helper-Logger
 * */
class MiniLog {
    /**
     *    
     * @param {integer} loglevel - Use loglevels constants
     */
    constructor(loglevel) {
        this.loglevel = ((loglevel >= 1) & (loglevel <= 4)) ? Math.floor(loglevel) : 1;
    }
    log(anything) {
        if (this.loglevel >= 3) console.log(arguments);
    }
    info(anything) {
        if (this.loglevel >= 3) console.log(arguments);
    }
    debug(anything) {
        if (this.loglevel >= 4) console.log(arguments);
    }
    warn(anything) {
        if (this.loglevel >= 2) console.log(arguments);
    }
    error(anything) {
        console.error(arguments);
    }
}




const knxd = require('eibd');
//const Readable = require('stream').Readable;
const http = require('http');
const EventEmitter = require('events');

// load the configuration
var argv = require('minimist')(process.argv.slice(2));

const fs = require('fs'),
    path = require('path');

var filePath = path.join(__dirname, 'config.json');

//console.dir(argv);

let custFile = argv['config'] || argv['c']

if (custFile) {
    // custom parameter
    if (path.isAbsolute(custFile)) {
        filePath = custFile;
    } else {
        filePath = path.join(__dirname, custFile);
    }
}

var file, config;
try {
    file = fs.readFileSync(filePath, { encoding: 'utf-8' });
} catch (e) {
    console.error('Could not read configuration file at ' + filePath);
    throw e;
}
try {
    config = JSON.parse(file);
} catch (e) {
    console.log("There was a problem reading your " + filePath + " file.");
    console.log("Please try pasting your file here to validate it: http://jsonlint.com");
    console.log("");
    throw e;
}

const minilog = new MiniLog(config.loglevel || loglevels.Warning);

/**
 * @classdesc A BusListener object is connected to a GropupSocketListener object and reacts on telegrams that are passed. It builds a local cache with the latest telegrams
 * @emits 'busevent' - on data
 * */
class BusListener extends EventEmitter {
    /**
     *  @param {GroupSocketListener} groupSocketListener - A connected GroupSocketListener object
     * */
    constructor(groupSocketListener) {
        super();
        this._valueCache = {};
        this.listener = groupSocketListener;
        this.listener.on('newParserConnection', this._onConnectionReconnect.bind(this));
        this._connect(groupSocketListener.parserObject);
    } // constructor
    // need to re-connect the events once the connection was broken, so own function!
    _connect(parserObject) {
        if (parserObject) {
            minilog.debug('BusListener._connect()');
            this._sourceParser = parserObject;
            this._sourceParser.on('telegram', this._onTelegram.bind(this));
        } else {
            minilog.debug('BusListener._connect() - Parser not ready yet');
        }

    }
    /**
     * If the connection is severed, the listeners have to be updated to the new connection
     * @param {any} groupSocketListener
     */
    _onConnectionReconnect(groupSocketListener) {
        minilog.debug('BusListener._onConnectionReconnect()');
        this.listener = groupSocketListener;
        this._connect(groupSocketListener.parserObject);
    }

    /**
     * Whenever a telegram is arriving on the bus, this event handler will cache the value (if it's a write or response telegram, that is) and pass the value as hex string to listeners of 'busevent' emits
     * @param {string} event - Either 'read', 'write', 'response', 'memory write' - telegram type
     * @param {string} src - Source Address (physical)
     * @param {String} destGA - Desination Address (Group)
     * @param {Buffer} valbuffer - Buffer for the value in binary, non-interpreted format
     */
    _onTelegram(event, src, destGA, valbuffer) {
        //minilog.debug('[ok] event ' + event + '; from: ' + src + '; Dest: ' + destGA + ' Value: ' + valbuffer.toString('hex'));
        //call all the users 
        if (['write', 'response'].indexOf(event) >= 0) {
            this._valueCache[destGA] = { timestamp: Math.floor(new Date() / 1000), value: valbuffer.toString('hex') };
            //minilog.debug('busevent fires for ' + destGA);
            this.emit('busevent', destGA, valbuffer.toString('hex'))
        } else {
            minilog.debug('[ok] ignored: ' + event + ' for Dest: ' + knxd.addr2str(destGA, true));
        }
    } // onTelegram
}
/**
 * @classdesc A low level listener on the bus that can handle the connection (and issues therewith) and emit events
 * @emits 'newParserConnection' - on reconnect
 * */
class GroupSocketListener extends EventEmitter {
    constructor(opts) {
        super();
        this.opts = opts;
        this._connect();
    }
    _connect() {
        this.knxdconnection = new knxd.Connection();
        this.connected = false;
        // try to connect
        this.knxdconnection.socketRemote(this.opts, this._callback1_connect.bind(this));
        this.knxdconnection.on('close', this._onConnectionClose.bind(this));

    }
    _callback1_connect(err) {
        if (err) {
            minilog.error('[ERR] knxd connection for reading failed: ' + err);
            //status.knxderrors += 1;
            return;
        }
        minilog.debug('[OK] knxd connected.');
        this.connected = true;
        this.knxdconnection.openGroupSocket(0, this._callback2_groupsocket.bind(this));
    }
    _callback2_groupsocket(parser) {
        minilog.debug('GroupSocketListener._callback2_groupsocket: "parser ready"');
        this.parserObject = parser;
        this.emit('newParserConnection', this)
    }
    /**
    * tries to reopen the connection of the connection breaks
    * */
    _onConnectionClose() {
        minilog.error('[ERR] knxd connection for reading disconnected.');
        setTimeout(function () {
            //status.knxderrors += 1;
            minilog.warn('[ERR] knxd reconnect attempt.');
            this._connect();
        }, 100);
    }
}


/**
 * @classdesc GroupReader listens to a set of GroupAddresses and emits events if they are changed on the bus
 * @emits 'newData', {string} groupaddress, {string} value - on values (write/response) for the GroupAddresses used in the constructor
 * 
 * */
class GroupReader extends EventEmitter {
    // emits: 'newData', <group address>, <value hex>
    /**
     *      
     * @param {BusListener} buslistener - Instance to connect to
     * @param {Array<string>} gaArray - Addresses to listen to
     */
    constructor(buslistener, gaArray) {
        super();
        this.filter = [];
        this.addresses = gaArray;
        this.buslistener = buslistener;
        this.boundNewEvent = this.newEvent.bind(this)
        buslistener.on('busevent', this.boundNewEvent);
        minilog.debug(this.addresses);
        this.indexOfReader = indGroupReader++;
    }
    /**
     * 
     * @param {string} ga - GroupAddress
     * @param {string} value - hex-encoded value
     */
    newEvent(ga, value) {
        minilog.debug(this.indexOfReader + ': GroupReader.newEvent(): ' + ga + ' listening for ' + this.addresses + ' (count: ' + this.addresses.length + ')');
        if (this.addresses.includes(ga)) {
            minilog.debug('GroupReader.newEvent() "if" hit');
            this.emit('newData', ga, value);
        }
    }
    closeGR() {
        // unsubscribe
        minilog.debug('GroupReader.closeGR() for ' + this.addresses);
        this.buslistener.removeListener('busevent', this.boundNewEvent);
        this.addresses = ['999999999999999999999']; // does not fit on anything anymore
        this.indexOfReader = 'Dead animal! ';
    }
}
/**
 * @classdesc Server Sent Event Stream (SSEStream) sends continues stream of new data to the Resonse object it is initialized with.
 * */
class SSEStream {
    /**
     * 
     * @param {BusListener} buslistener
     * @param {Response} response
     * @param {Request} request
     * @param {Array<string>} gaArray
     * @param {GroupSocketWriter} groupSocketWriter
     */
    constructor(buslistener, response, request, gaArray, groupSocketWriter) {
        minilog.debug('SSEStrem constructor for ' + gaArray);
        //console.dir(gaArray);
        // create a new listner to the events
        this.groupReader = new GroupReader(buslistener, gaArray);
        this.boundUpdate = this.update.bind(this)
        this.groupReader.on('newData', this.boundUpdate);
        this.index = 0;
        this.response = response;
        this.request = request;
        this.boundCloseSSE = this.closeSSE.bind(this)
        this.request.on('close', this.boundCloseSSE); // clean up if the request line is closed
        this.response.on('close', this.boundCloseSSE); // clean up if the response line is closed
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'connection': 'keep-alive' });
        this.ID = new Date();
        //get all the cached data and send it
        let answer = "";
        let addressesToRead = [];
        for (let i = 0; i < gaArray.length; i++) {
            let ga = gaArray[i];
            if (buslistener._valueCache.hasOwnProperty(ga)) {
                if (answer) {
                    answer = answer + ',';
                }
                answer = answer + '"' + ga + '":"' + buslistener._valueCache[ga].value + '"'; // part of the json
            } else {
                addressesToRead.push(ga);
            }
        }
        if (answer) {
            this.response.write('event: message\ndata:{"d":{' + answer + '}, "i":0}\nid:' + this.index + '\n\n');
        } else {
            this.response.write('event: message\ndata:{"d":{ }, "i":0}\nid:' + this.index + '\n\n');
        }
        this.updateKeepalive();
        // try to read the addresses that were not in the cache
        for (let i = 0; i < addressesToRead.length; i++) {
            groupSocketWriter.readAddress(addressesToRead[i]);
        }
    }
    /**
     * Updates the EventStream through writing to the response object
     * @param {string} ga - Group Address
     * @param {string} value - hex encoded value
     */
    update(ga, value) {
        this.index += 1;
        minilog.info(this.ID.toISOString() + ' SSEStream.update(' + ga + ',' + value + ')');
        this.response.write('event: message\ndata:{"d":{"' + ga + '":"' + value + '"}, "i":' + this.index + '}\nid:' + this.index + '\n\n'); //  message as event type, and preceed data object with data:
        this.updateKeepalive();
    }
    updateKeepalive() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(this.keepalive.bind(this), config.http.keepaliveSecs * 1000);
    }
    /**
     * sends an empty data package to keep proxies alive (happened with mod_proxy of apache)
     * */
    keepalive() {
        this.index += 1;
        minilog.info(this.ID.toISOString() + ' SSEStream.keepalive()');
        this.response.write('event: keepalive\ndata:{"d":{}, "i":' + this.index + '}\nid:' + this.index + '\n\n'); //  message as event type, and preceed data object with data:
        this.updateKeepalive();
    }
    /**
     * Close the response object, detaches all listeners
     * */
    closeSSE() {
        // close the stream!
        this.response.end();
        minilog.info(this.ID + ' SSEStrem.closeSSE(): got request.close event');
        this.groupReader.removeListener('newData', this.boundUpdate);
        this.groupReader.closeGR();
        this.groupReader = undefined;
        this.request.removeListener('close', this.boundCloseSSE);
        this.response.removeListener('close', this.boundCloseSSE);
    }
}
/**
 * @classdesc A class for sending data to the bus. 
 * TODO: currently it requires closing and re-opening of the connection after each sent telegram. Investigation pending.
 * */
class GroupSocketWriter {
    constructor(opts) {
        this.opts = opts;
        this._connect();
    }
    _connect() {
        this.knxdconnection = new knxd.Connection();
        this.connected = false;
        // try to connect
        this.knxdconnection.socketRemote(this.opts, this._callback1_connect.bind(this));
        this.knxdconnection.on('close', this._onConnectionClose.bind(this));

    }
    _callback1_connect(err) {
        if (err) {
            minilog.error('[ERR] knxd connection for writing failed: ' + err);
            //status.knxderrors += 1;
            return;
        }
        minilog.debug('[OK] knxd connected.');
        this.connected = true;
    }
    /**
    * Writes a data package to the bus if a connection is established
    * @param {string} groupAddress KNX group address in 3 tier notation "1/2/3"
    * @param {string} rawValueHexString value in a string, encoded as hexadecimals
    */
    writeData(groupAddress, rawValueHexString) {
        var dest = knxd.str2addr(groupAddress);
        if (dest === 'Error: Could not parse address') {
            minilog.error('Invalid Address ' + groupAddress);
        } else {
            minilog.debug("DEBUG knxwrite Address conversion, converted " + groupAddress + " to " + dest);
            if (this.connected) {
                this.knxdconnection.openTGroup(dest, 1, function (err) {
                    if (err) {
                        minilog.error("[ERROR] knxwrite:openTGroup: " + err);

                    } else {
                        minilog.debug("DEBUG opened TGroup ");
                        var msg = this._hexValStringToArray(rawValueHexString);
                        //minilog.debug(rawValueHexString);
                        //minilog.debug(msg);
                        this.knxdconnection.sendAPDU(msg, function (err) {
                            if (err) {
                                minilog.error("[ERROR] knxwrite:sendAPDU: " + err);
                            } else {
                                minilog.debug("GroupSocketWriter: knx data sent: Value " + rawValueHexString + " for GA " + groupAddress);
                                this.knxdconnection.end(); //TODO: this reqires a new connection every time!
                            }
                        }.bind(this), true); // should not close the connection automatically
                    }
                }.bind(this)
                )
            } else {
                minilog.error('[ERR] no active knxd connection for writing.');
            }
        }
    }
    /**
     * Issues read request on the bus
     * @param {string} groupAddress three tier format like 1/2/3
     */
    readAddress(groupAddress) {
        var dest = knxd.str2addr(groupAddress);
        if (dest === 'Error: Could not parse address') {
            minilog.error('Invalid Address ' + groupAddress);
        } else {
            minilog.debug("DEBUG knxwrite Address conversion, converted " + groupAddress + " to " + dest);
            if (this.connected) {
                this.knxdconnection.openTGroup(dest, 1, function (err) {
                    if (err) {
                        minilog.error("[ERROR] knxwrite:openTGroup: " + err);

                    } else {
                        minilog.debug("DEBUG opened TGroup ");
                        var msg = knxd.createMessage('read', '', 0);
                        this.knxdconnection.sendAPDU(msg, function (err) {
                            if (err) {
                                minilog.error("[ERROR] knxwrite:sendAPDU: " + err);
                            } else {
                                minilog.debug("GroupSocketWriter.readAddress: read request sent for GA " + groupAddress);
                                this.knxdconnection.end(); //TODO: this reqires a new connection every time!
                            }
                        }.bind(this), true); // should not close the connection automatically
                    }
                }.bind(this)
                )
            } else {
                minilog.error('[ERR] no active knxd connection for writing.');
            }
        }
    }


    /**
     * tries to reopen the connection of the connection breaks
     * */
    _onConnectionClose() {
        minilog.debug('[ERR] knxd connection for writing disconnected.');
        this.connected = false;
        setTimeout(function () {
            //status.knxderrors += 1;
            minilog.warn('[ERR] knxd reconnect attempt.');
            this._connect();
        }.bind(this), 100);
    }
    /**
     * Convert a valueHexString from CometVisu into an ADPU Buffer
     * @param {string} valueHexString
     * @returns {Array<Integer>}
     * */
    _hexValStringToArray(valueHexString) {
        let buf = Buffer.from(valueHexString, 'hex');
        // make sure first bit is set (for writing command)
        buf.writeUInt8((buf[0] | 128) & 191, 0); // first bit set, second empty
        let ret = Buffer.concat([Buffer.alloc(1), buf]);
        return Array.prototype.slice.call(Buffer.concat([Buffer.alloc(1), buf]), 0);
    }
}
/**
 * 
 * @param {BusListener} busListener - Class instance for hearing group chat on the bus
 * @param {GroupSocketWriter} groupSocketWriter - writer instance to write own data to the bus
 */
function createRequestServer(busListener, groupSocketWriter) {
    const altKNXAddrPars = /"KNX:(.*?)"/;
    let requestserver = http.createServer(function (request, response) {
        minilog.debug('http.createServer CALLBACK FUNCTION URL=' + request.url);
        var reqparsed = request.url.substr(1).split('?');
        var params = {};
        var paramstemp = [];
        if (reqparsed[1]) {
            paramstemp = reqparsed[1].split('&');
            for (var i = 0; i < paramstemp.length; i++) {
                /** @type {Array<string>} */
                var b = paramstemp[i].split('=');
                let key = decodeURIComponent(b[0]);
                minilog.debug(key);
                minilog.debug(params[key]);
                let value = decodeURIComponent(b[1] || '');
                minilog.debug(value);
                if (params[key]) {
                    // key already exists
                    if (params[key] instanceof Array) {
                        // it is an array
                        params[key] = params[key].concat(value);
                    } else {
                        // make an array
                        params[key] = [params[key], value];
                    }
                } else {
                    // first of key
                    params[key] = value;
                }
            }
        }
        /*
         * Now we have: path in reqparsed[0] like "list" or "delete"
         * param
         */
        if (reqparsed[0] === "login") {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            let login_response = `
             {
              "v":"0.0.1",
              "s":"0",
              "c": {
                "name":"knxsse",
                "transport":"sse",
                "baseURL":"/rest/cv/",
                "resources": {
                  "read":"read",
                  "rrd":"rrdfetch",
                  "write":"write"
                }
              }
            } `;
            response.write(login_response);
            response.end('');

        } else if (reqparsed[0] === 'read') {
            minilog.debug("READ request parsing");
            // request is /read&s=SESSION&a=1/2/3&a=2/3/4

            if (params['a']) {
                // parse the KNX addresses
                //minilog.debug(params['a']);
                let listenTo = [];
                for (let i in params.a) {
                    //minilog.debug(addr);
                    let addr = params.a[i];
                    if (altKNXAddrPars.test(addr)) {
                        addr = addr.replace(/"KNX:(.*?)"/, function (match, p1) { return p1 }); // remove quotes and
                    }
                    listenTo.push(addr);
                }
                // need to async detach now!!!!
                new SSEStream(busListener, response, request, listenTo, groupSocketWriter);
            }
        } else if (reqparsed[0] === 'write') {
            // write to (multiple) addresses
            minilog.debug('writing to');
            let addresses = params['a']
            minilog.debug(addresses);
            if (typeof addresses === Array) {
                for (let i = 0; i < params.a.length; i++) {
                    minilog.debug(params.a[i], params.v);
                    groupSocketWriter.writeData(params.a[i], params.v);
                }
            } else {
                groupSocketWriter.writeData(addresses, params.v);
            }
            response.writeHead(200);
            response.end('OK');
        } else if (reqparsed[0] === 'cache') {
            minilog.debug('[INFO] request');
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.write('<html><head><title> KNX GroupAddress Cache</title></head><body>');
            response.write('<H1>Cache Contents</H1>');
            response.write('<table><tr><th>Address</th><th>Timestamp</th><th>Last Value</th></tr>');

            // print sorted table
            let keys = [];
            for (let k in busListener._valueCache) {
                if (busListener._valueCache.hasOwnProperty(k)) {
                    keys.push(k);
                }
            }
            keys.sort(); //kind of sort: without specific function 1/10/2 < 1/9/2 !!
            for (let i = 0; i < keys.length; i++) {
                response.write('<tr><td>' + keys[i] + '</td><td>' + busListener._valueCache[keys[i]].timestamp + '</td><td>' + busListener._valueCache[keys[i]].value + '</td>');
            }
            //for (let addr in buslistener._valueCache) {
            //    response.write('<tr><td>' + addr + '</td><td>' + buslistener._valueCache[addr] + '</td>');
            //}
            response.write('</table>');

            // console.dir(rows);
            response.write('<BR>EOL</body>');
            response.end('</html>\n');

        } else {
            // catchall
            response.writeHead(404);
            response.end('Not found');
        }
    });
    return requestserver;
}


// MAIN **********************************************************************************************
// connect to the KNX bus for LISTENING
const groupSocketListener = new GroupSocketListener(config.knxd);
const busListener = new BusListener(groupSocketListener);

// connect to the KNX bus for WRITING
const groupSocketWriter = new GroupSocketWriter(config.knxd);


// start webserver and attach it to the port given in config
if (!config.http.port || config.http.port <= 1024 || config.http.port >= 65000) {
    minilog.error('[OK] Webserver not started, no config.http.port configured or port<=1024 or port>=65000');
} else {
    // start the webserver
    const webserver = createRequestServer(busListener, groupSocketWriter);
    webserver.listen(config.http.port);
    minilog.info('Server started, listening on port ' + config.http.port);
}









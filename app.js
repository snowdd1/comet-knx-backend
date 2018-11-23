/* jshint esversion: 6, strict: true, node: true */

'use strict';


/* *********
 * Plan: 
 * 
 * connect to eibd
 * get all raw telegrams
 * store all values in a key-value store (aka object, dictionary etc.)
 * provide a read hook (http/https) using SSE (simple sample https://www.w3schools.com/html/html5_serversentevents.asp )
 * provide a write hook (dito) - 
 * provide a login hook (dito) https://github.com/CometVisu/CometVisu/wiki/Protokoll#login resp https://knx-user-forum.de/forum/supportforen/cometvisu/1288069-noch-eine-knxd-auf-zweitem-server?p=1288496#post1288496
 * 
 *
 */
// knx monitor
/**
 * Configuration Object
 * */
let config = {
    knxd: {
        host: "knxd2-raspberry.zu.hause",
        port: 6720
    },
    http: {
        cacheport: 32150
    }
}

/**
 * @type {{Info: Integer, Debug: Integer, Warning: Integer, Error: Integer}}
 * */
const loglevels = { Info: 4, Debug: 3, Warning: 2, Error: 1 }


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
        if (this.loglevel >= 4) console.log(arguments);
    }
    debug(anything) {
        if (this.loglevel >= 3) console.log(arguments);
    }
    warn(anything) {
        if (this.loglevel >= 2) console.log(arguments);
    }
    error(anything) {
        console.error(arguments);
    }
}

const minilog = new MiniLog(loglevels.Info);





/*
 * Required configuration for bus access
 */



const knxd = require('eibd');
//const Readable = require('stream').Readable;
const http = require('http');
const EventEmitter = require('events');



// ***************************** debugging fcts only, can be removed before shipping ***************************
function hex2bin(hex) {
    return ("00000000" + (parseInt(hex, 16)).toString(2)).substr(-8);
}
function byte2bin(byte) {
    return ("00000000" + (byte).toString(2)).substr(-8);
}
function buffer2bin(buf) {
    let a = ''
    minilog.debug('buffer2bin length: ' + buf.length)
    for (let i = 0; i < buf.length; i++) {
        //minilog.debug(buf.readUInt8(i));
        a = a + (' 000' + i.toString(10)).substring(-4) + ':' + byte2bin(buf.readUInt8(i))
    }
    return a;
}
// ********************* END *****************


/**
 * @classdesc A BusListener object is connected to a GropupSocketListener object and reacts on telegrams that are passed. It builds a local cache with the latest telegrams
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
    _onConnectionReconnect(groupSocketListener) {
        minilog.debug('BusListener._onConnectionReconnect()');
        this.listener = groupSocketListener;
        this._connect(groupSocketListener.parserObject);
    }

    /**
     * 
     * @param {string} event - Either 'read', 'write', 'response', 'memory write' - telegram type
     * @param {string} src - Source Address (physical)
     * @param {String} destGA - Desination Address (Group)
     * @param {Buffer} valbuffer - Buffer for the value in binary, non-interpreted format
     */
    _onTelegram(event, src, destGA, valbuffer) {
        minilog.debug('[ok] event ' + event + '; from: ' + src + '; Dest: ' + destGA + ' Value: ' + valbuffer.toString('hex'));
        //call all the users 
        if (['write', 'response'].indexOf(event)>=0) {
            this._valueCache[destGA] = { timestamp: Math.floor(new Date() / 1000), value: valbuffer.toString('hex') };
            minilog.debug('busevent fires for ' + destGA);
            this.emit('busevent', destGA, valbuffer.toString('hex'))
        } else {
            minilog.debug('[ok] ignored: ' + event + ' for Dest: ' + knxd.addr2str(destGA, true));
        }
    } // onTelegram
}



//var buslistener;



class GroupSocketListener extends EventEmitter {
    constructor(opts) {
        super();
        this.opts = opts;
        this._connect();
    }
    _connect() {
        this.knxdconnection = knxd.Connection();
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



class GroupReader extends EventEmitter {
    // emits: 'newData', <group address>, <value hex>
    constructor(buslistener, gaArray) {
        super();
        this.filter = [];
        this.addresses = gaArray;
        buslistener.on('busevent', this.newEvent.bind(this));
        minilog.debug(this.addresses);
    }
    newEvent(ga, value) {
        minilog.debug('GroupReader.newEvent(): ' + ga)
        // BROKEN this bound to EMITTER not receiver ////////////////////////////////////
        if (this.addresses.includes(ga)) {
            minilog.debug('GroupReader.newEvent() "if" hit');
            this.emit('newData', ga, value)
        }
    }
}
class SSEStream {
    /**
     * 
     * @param {BusListener} buslistener
     * @param {Response} response
     * @param {Array} gaArray
     */
    constructor(buslistener, response, gaArray) {
        minilog.debug('SSEStrem constructor:');
        console.dir(gaArray);
        // create a new listner to the events
        this.groupReader = new GroupReader(buslistener, gaArray);
        this.groupReader.on('newData', this.update.bind(this));
        this.response = response;
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'connection': 'keep-alive' });
        //get all the cached data and send it
        let answer = "";
        for (let i = 0; i < gaArray.length; i++) {
            let ga = gaArray[i];
            if (buslistener._valueCache.hasOwnProperty(ga)) {
                answer = answer + (answer) ? ', "' : '"' + ga + '":"' + buslistener._valueCache[ga] + '"'; // part of the json
            }
        }
        if (answer) {
            this.response.write('{"d":{' + answer + '}}\n\n');
        }

    }
    update(ga, value) {
        minilog.debug('SSEStream.update(' + ga + ',' + value + ')');
        this.response.write('{"d":{"' + ga + '":"' + value + '"}}\n\n');
    }
}

class GroupSocketWriter {
    constructor(opts) {
        this.opts = opts;
        this._connect();
    }
    _connect() {
        this.knxdconnection = knxd.Connection();
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
    * @param {string} groupAddress - KNX group address in 3 tier notation "1/2/3"
    * @param {string} rawValueHexString - value in a buffer
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
                        var msg = this._hexValStringToBuffer(rawValueHexString); //knxd.createMessage('write', dpt, parseFloat(value));
                        //minilog.debug(rawValueHexString);
                        //minilog.debug(msg);
                        this.knxdconnection.sendAPDU(msg, function (err) {
                            if (err) {
                                minilog.error("[ERROR] knxwrite:sendAPDU: " + err);
                            } else {
                                minilog.debug("GroupSocketWriter: knx data sent: Value " + rawValueHexString + " for GA " + groupAddress);
                            }
                        }.bind(this), true); // should not close the connection
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
     * @returns {Buffer}
     * */
    _hexValStringToBuffer(valueHexString) {
        let buf = Buffer.from(valueHexString, 'hex');
        // make sure first bit is set (for writing command)
        buf.writeUInt8((buf[0] | 128) & 191, 0); // first bit set, second empty
        let ret = Buffer.concat([Buffer.alloc(1), buf]);
        //check
        //console.log(ret);
        //console.log(knxd.createMessage('write', 'DPT1', parseFloat(1)))
        //throw (new Error('STOP HERE'));

        //return Buffer.concat([Buffer.alloc(1), buf]); // first byte MUST BE 00
        return Array.prototype.slice.call(Buffer.concat([Buffer.alloc(1), buf]), 0);
    }
}

// writer
// VISU sends 
// 80 for an OFF value, 81 for ON, ==> short DPT1
// 80ff for a 255 one byte DPT5
// 800fc4 for a DPT9 float
// 





//web server



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
                /** @type {string[]} */
                var b = paramstemp[i].split('=');
                if (params[decodeURIComponent(b[0])]) {
                    if (typeof params[decodeURIComponent(b[0])] === Array) {
                        minilog.debug("it''s an array, add " + decodeURIComponent(b[1]));
                        params[decodeURIComponent(b[0])].concat(decodeURIComponent(b[1]));
                    } else {
                        minilog.debug("it's not an array, make one with " + params[decodeURIComponent(b[0])] + ' and ' + decodeURIComponent(b[1]));
                        params[decodeURIComponent(b[0])] = [params[decodeURIComponent(b[0])], decodeURIComponent(b[1])];
                    }
                } else {
                    minilog.debug("it's first occurrence, " + decodeURIComponent(b[1] || ''));
                    params[decodeURIComponent(b[0])] = decodeURIComponent(b[1] || '');
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
                minilog.debug(params['a']);
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
                new SSEStream(busListener, response, listenTo);
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
            for (let k in buslistener._valueCache) {
                if (buslistener._valueCache.hasOwnProperty(k)) {
                    keys.push(k);
                }
            }
            keys.sort(); //kind of sort: without specific function 1/10/2 < 1/9/2 !!
            for (let i = 0; i < keys.length; i++) {
                response.write('<tr><td>' + keys[i] + '</td><td>' + buslistener._valueCache[keys[i]].timestamp + '</td><td>' + buslistener._valueCache[keys[i]].value + '</td>');
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



//groupsocketlisten(config.knxd);

// MAIN
// connect to the KNX bus for LISTENING
const groupSocketListener = new GroupSocketListener(config.knxd);
const busListener = new BusListener(groupSocketListener);


// connect to the KNX bus for WRITING
const groupSocketWriter = new GroupSocketWriter(config.knxd);


const webserver = createRequestServer(busListener, groupSocketWriter);


if (!config.http.cacheport || config.http.cacheport <= 1024 || config.http.cacheport >= 65000) {
    minilog.debug('[OK] Webserver not started, no config.http.cacheport configured or cacheport<=1024 or cacheport>=65000');
} else {
    webserver.listen(config.http.cacheport);
}









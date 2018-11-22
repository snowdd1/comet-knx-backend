/* jshint esversion: 6, strict: true, node: true */

'use strict';
console.log('Hello world');

/**********
 * Plan: 
 * 
 * connect to eibd
 * get all raw telegrams
 * store all values in a key-value store (aka object, dictionary etc.)
 * provide a read hook (http/https) using SSE (simple sample https://www.w3schools.com/html/html5_serversentevents.asp )
 * provide a write hook (dito) - 
 * provide a login hook (dito) https://github.com/CometVisu/CometVisu/wiki/Protokoll#login resp https://knx-user-forum.de/forum/supportforen/cometvisu/1288069-noch-eine-knxd-auf-zweitem-server?p=1288496#post1288496
 * 
 * sample login response
 {
  "v":"0.0.1",
  "s":"0",
  "c": {
    "name":"openhab2",
    "transport":"sse",
    "baseURL":"/rest/cv/",
    "resources": {
      "read":"r",
      "rrd":"rrdfetch",
      "write":"w"
    }
  }
}

 *
 */

// knx monitor
let config = {
    knxd: {
        host: "knxd2-raspberry.zu.hause",
        port: 6720
    },
    http: {
        cacheport: 32150
    }
}


/*
 * Required configuration for bus access
 */



const knxd = require('eibd');
const Readable = require('stream').Readable;
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
    console.log('buffer2bin length: ' + buf.length)
    for (let i=0; i < buf.length; i++) {
        //console.log(buf.readUInt8(i));
        a = a + (' 000' + i.toString(10)).substring(-4)+':' + byte2bin(buf.readUInt8(i))
    }
    return a;
}
// ********************* END *****************


// thgis actually is a part of the actual node-eibd, so I can try to remove that later
class BusListener extends EventEmitter { //, Readable {
    constructor(KNXConnection) {
        super();
        this._source = KNXConnection.socket;
        this._inputBuffer =  Buffer.from("");
        this._valueCache = {};
        var self = this;
        // hit source end
        this._source.on('end', function () {
            console.log('knxd _source(end) event');

        });

        // get data
        this._source.on('data', function (data) {
            //		console.log('data!');
            self.onBusData(data);
        });
    } // constructor
    onBusData(chunk) {
        // no data received
        if (chunk === null) {
            return;
        }
        // store chunk
        this._inputBuffer = Buffer.concat([this._inputBuffer, chunk]);
        while (true) {
            // check if at least length header is here
            if (this._inputBuffer.length < 2) {
                return;
            }
            var packetlen = this._inputBuffer[1] + 2;
            if (packetlen > this._inputBuffer.length) {
                //not enough data
                return;
            }
            //    console.log('some data');
            //what kind of packet have we got...
            //console.log('-------------------------------------------------')
            //console.log('Buffer input:')
            //console.log(buffer2bin(this._inputBuffer))
            if (packetlen === 4) {
                //confirm mag
            } else if (packetlen === 5) {
                //opengroupsocket
            } else if (packetlen >= 6) {
                // we have at least one complete package
                var telegram = new Buffer(this._inputBuffer.slice(0, packetlen));
                // emit event
                var self = this;
                var len = telegram.readUInt8(1) & (1+2+4+8);
                // 4 + 5 src adr.
                var src = telegram.readUInt16BE(4);
                // 6 + 7 dest adr.
                var dest = telegram.readUInt16BE(6);
                // action
                var action = (telegram.readUInt8(8) & (3))*8+((telegram.readUInt8(9) & (192)) >> 6); //bytes 8 lowest 2 bits and byte 9 highest two bits are action (AND VALUE if VALUE HAS LESS THEN 7 bits !!!!)
                var event = '';
                switch (action) {
                    case 10:
                        event = 'memory write';
                        break;
                    case 2:
                        event = 'write';
                        break;
                    case 1:
                        event = 'response';
                        break;
                    case 0:
                        event = 'read';
                        break;
                }
                if (action > 0) {
                    // value
                    var val = null;
                    val = Buffer.from([telegram[telegram.length - 1] & (63) ]); // do not make it a number! ONLY 6 BITS FOR DATA
                    if (len > 8) {
                        val = telegram.slice(10, telegram.length);
                    }
                    let destGA = knxd.addr2str(dest, true);
                    let value = val.toString('hex')
                    console.log('[ok] action:' + (action ) + '; event ' + event + '; Dest: ' + destGA + ' Len ' + len + ' Value: ' + value);
                    //call all the users 
                    this._valueCache[destGA] = { timestamp: Math.floor(new Date() / 1000), value: value };
                    console.log('busevent fires for ' + destGA);
                    this.emit('busevent',destGA,value)
                } else { // a READ telegram only
                    //if (groupaddresses[dest]) {
                    //    //known address with type
                    //    // console.dir(null, groupaddresses[dest] ));
                    //}
                    console.log('[ok] ignored: read for Dest: ' + knxd.addr2str(dest, true));
                }
            }
            this._inputBuffer = new Buffer(this._inputBuffer.slice(packetlen));
        }

    } // onBusData
}


var buslistener;

function groupsocketlisten(opts) {
    var conn = knxd.Connection();
    conn.socketRemote(opts, function (err) {
        if (err) {
            console.log('[ERR] knxd connection failed: ' + err);
            //status.knxderrors += 1;
            return;
        }
        console.log('[OK] knxd connected.');
        conn.openGroupSocket(0, function (parser) {
            //telegramhandler(parser);
        });
    });

    conn.on('close', function () {
        // restart...
        console.log('[ERR] knxd disconnected.');
        setTimeout(function () {
            //status.knxderrors += 1;
            console.log('[ERR] knxd reconnect attempt.');
            groupsocketlisten(opts);
        }, 100);
    });
    console.log(typeof conn);
    buslistener = new BusListener(conn);
}



class GroupReader extends EventEmitter {
    // emits: 'newData', <group address>, <value hex>
    constructor(buslistener, gaArray) {
        super();
        this.filter = [];
        this.addresses = gaArray;
        buslistener.on('busevent', this.newEvent.bind(this));
        console.log(this.addresses);
    }
    newEvent(ga, value) {
        console.log('GroupReader.newEvent(): ' + ga)
        // BROKEN this bound to EMITTER not receiver ////////////////////////////////////
        if (this.addresses.includes(ga)) {
            console.log('GroupReader.newEvent() "if" hit');
            this.emit('newData', ga, value)
        }
    }


}


class SSEStream {
    constructor(buslistener, response, gaArray) {
        console.log('SSEStrem constructor:');
        console.dir(gaArray);
        // create a new listner to the events
        this.groupReader = new GroupReader(buslistener, gaArray);
        this.groupReader.on('newData', this.update.bind(this));
        this.response = response;
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'connection':'keep-alive' });
        //get all the cached data and send it
        let answer = "";
        for (let i = 0; i < gaArray.length; i++) {
            ga = gaArray[i];
            if (buslistener._valueCache.hasOwnProperty(ga)) {
                answer = answer + (answer)?', "':'"' + ga + '":"' + buslistener._valueCache[ga] + '"'; // part of the json
            }
        }
        if (answer) {
            this.response.write('{"d":{' + answer + '}}\n\n');
        }

    }
    update(ga, value) {
        console.log('SSEStream.update(' + ga + ',' + value + ')');
        this.response.write('{"d":{"' + ga + '":"' + value + '"}}\n\n');
    } 
}


// writer
// VISU sends 
// 80 for an OFF value, 81 for ON, ==> short DPT1
// 80ff for a 255 one byte DPT5
// 


//web server

const altKNXAddrPars = /"KNX:(.*?)"/;

let requestServer = http.createServer(function (request, response) {
    console.log('http.createServer CALLBACK FUNCTION URL=' + request.url);
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
                    console.log("it''s an array, add " + decodeURIComponent(b[1]));
                    params[decodeURIComponent(b[0])].concat(decodeURIComponent(b[1]));
                } else {
                    console.log("it's not an array, make one with " + params[decodeURIComponent(b[0])] + ' and ' + decodeURIComponent(b[1]));
                    params[decodeURIComponent(b[0])] = [params[decodeURIComponent(b[0])], decodeURIComponent(b[1])];
                }
            } else {
                console.log("it's first occurrence, " + decodeURIComponent(b[1] || ''));
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
        console.log("READ request parsing");
        // request is /read&s=SESSION&a=1/2/3&a=2/3/4
        
        if (params['a']) {
            // parse the KNX addresses
            console.dir(params['a']);
            let listenTo = [];
            for (let i in params.a) {
                //console.log(addr);
                let addr = params.a[i];
                if (altKNXAddrPars.test(addr)) {
                    addr = addr.replace(/"KNX:(.*?)"/, function (match, p1) { return p1 }); // remove quotes and
                } 
                listenTo.push(addr);
            }
            // need to async detach now!!!!
            new SSEStream(buslistener, response, listenTo);
        }
        
        
        
        //if (params.UUID) {
    } else if (reqparsed[0] === 'cache') {
        console.log('[INFO] request');
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

    }
});



groupsocketlisten(config.knxd);

if (!config.http.cacheport || config.http.cacheport <= 1024 || config.http.cacheport >= 65000) {
    console.log('[OK] Webserver not started, no config.http.cacheport configured or cacheport<=1024 or cacheport>=65000');
} else {
    requestServer.listen(config.http.cacheport);
}









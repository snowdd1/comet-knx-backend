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

http = require('http');
knx = require('node-eibd');



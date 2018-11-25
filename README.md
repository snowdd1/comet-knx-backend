# comet-knx-backend

Beta of an interface between [knxd](https://github.com/knxd/knxd) (the knx daemon) and [CometVisu](https://github.com/CometVisu/CometVisu) using Server Sent Events (SSE aka EventStream).

# Requires
ES6 e.g. NodeJS 10 LTS, get it here: [nodejs.org](https://nodejs.org)

## Install
* clone the repository
* rename file `config-sample.json` to `config.json`

## Configuration
* config.json
    * the *IP address or name* of the knxd server: Locate `knxd` object, `host: 'my-knxd-server.local'` change to your setup
    * the default port of 32150: See `http` object, locate `port:32150`
    * if required adjust the `keepaliveSecs` setting - if there was no telegram to be sent upstream to the CV this triggers an empty message to force the reverse proxy to keep the session alive
	* the debug output in stdout: set the level in `loglevel`: 4- Debug, 3-Info, 2-Warning, 1-Error only; defaults to Warning=2

* configure your webserver to proxy the following paths:
   * /rest/cv/read --> localhost:32150/read
   * /rest/cv/write --> localhost:32150/write
   * /rest/cv/login --> localhost:32150/login  
* configure your webserver to point `/rest/cv/login` in the apache settings.
See the sample in [010-apache2sample.conf](https://github.com/snowdd1/comet-knx-backend/blob/master/010-apache2sample.conf)



## Run
* start the server with `node knxcometbackend.js`
* optional parameters: `--config | -c <path>`: use other config-file than local config.json 


# not supported yet:
* rrdfetch


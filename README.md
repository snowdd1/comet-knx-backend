# comet-knx-backend

Beta of an interface between [knxd](https://github.com/knxd/knxd) (the knx daemon) and [CometVisu](https://github.com/CometVisu/CometVisu)

## Install
* clone the repository

## Configuration
* the *IP address or name* of the knxd server needs (still) to be put in knxcometbackend.js: See `config`object, locate `knxd` `host: 'knxd2-raspberry.zu.hause'` change to your setup
* the default port is 32150, you might (still) change that in the code ofd knxcometbackend.js: See `config` object, locate `cacheport:32150`
* if required asjust the `keepaliveSecs` setting - if there was no telegram to be sent upstream to the CV this triggers an empty message to force the reverse proxy to keep the session alive
* configure your webserver to proxy the following paths:
   * /rest/cv/read --> localhost:32150/read
   * /rest/cv/write --> localhost:32150/write
   * /rest/cv/login --> localhost:32150/login  
* configure your webserver to point `/rest/cv/login` in the apache settings.
See the sample in [010-apache2sample.conf](https://github.com/snowdd1/comet-knx-backend/blob/master/010-apache2sample.conf)



## Run
* start the server with `node knxcometbackend.js`

Of course this is not a permanent solution, you will need to create a service file (if on systemd-based OS like Raspbian)

# not supported yet:
* rrdfetch


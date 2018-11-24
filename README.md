# comet-knx-backend

Beta of an interface between [knxd](https://github.com/knxd/knxd) (the knx daemon) and [CometVisu](https://github.com/CometVisu/CometVisu)

## Install
* clone the repository

## Configuration
* the default port is 32150, you might (still) change that in the code: See `config` object, locate `cacheport:32150`
* configure your webserver to proxy the following paths:
   * /rest/cv/read --> localhost:32150/read
   * /rest/cv/write --> localhost:32150/write
   * /rest/cv/login --> localhost:32150/login  

See the sample in 010-apache2sample.conf

* configure your webserver to point `/rest/cv/login` in the apache settings, see [*German* KNX Forum post](https://knx-user-forum.de/forum/supportforen/cometvisu/1288069-noch-eine-knxd-auf-zweitem-server?p=1288496#post1288496)


## Run
* start the server with `node knxcometbackend.js`

Of course this is not a permanent solution, you will need to create a service file (if on systemd-based OS like Raspbian)

# not supported yet:
* rrdfetch

/**
 * server
 *
 * @author zzxun <xtkml.g@gmail.com>
 */
'use strict';

/**
 * module dependencies
 * @private
 */
const _ = require('lodash');
const thrift = require('thrift');
const EventEmitter = require('events').EventEmitter;
const ThriftMsg = require('../gen-nodejs/Message'),
      ttypes    = require('../gen-nodejs/msg_types'),
      utils     = require('./util'),
      redis     = require('./redis');

/**
 * thrift default host: port
 */
const PORT = 7007;

/**
 * manage all thrift handler
 */
class ThriftServer extends EventEmitter {

  /**
   * config options
   * @param {Object} options config include:
   *   {
   *     1. redis // {Object} redis config
   *     2. [handler] // {Array|Object} handler config, a array list or only one,
   *         or you can use `.add` to add new one (for js)
   *     3. thrift: { // thrift config
   *         [port]: get an unused port start from 7007
   *         [host]: get an ipv4 from eth0(linux) en0(osx)
   *         [handler]: use user define thrift handler
   *     }
   *   }
   */
  constructor(options) {
    // father
    super();
    // null
    options = options || {};
    // random server id
    this._id = utils.randStr();

    // init redis
    this._cache = new redis(options.redis);
    // redis on error
    this._cache.on('error', (err) => {
      this.emit(utils.EVENT.ERROR, err);
    });

    // parser thrift host port
    this._host = utils.getLocalIPv4();
    options.thrift = _.merge({port: PORT, host: this._host}, options.thrift);
    this._host = _.isString(options.thrift.host) ? options.thrift.host : this._host;
    utils.getUnusedPort(_.isNumber(options.thrift.port) ? options.thrift.port : PORT)
      .bind(this)
      .then((port) => {
        this._port = port;
      })
      .then(() => {

        // init thrift handler
        this._initThriftHandler();
        // inital handler
        this.add(options.handler);
      }).then(() => {

      // after inital all and start thrift server
      this._server = thrift.createServer(this._innerThriftProcessor, this._innerHandler, {});
      this._server.listen(this._port);

      // emit listening
      this._init = true;
      this.emit(utils.EVENT.LISTENING, 'ThriftServer host: ' + this._host + ' , port: ' + this._port, ' , id: ' + this._id);
    });
  }

  /**
   * add handler or handlers
   * @param {Array|Object} handler array - handlers, object - handlers, in each handler:
   *   {
   *     1. {String} [alias] // unique, if null, use the hanlder.name or hanlder.identity
   *     2. {Object|String} handle // handle object
   *     3. {Array|String} [methods] // method permission, if null, allow all hanlde's method,
   *      method support PROMISE/SYNC
   *     *4. {String} [version]
   *   }
   */
  add(handler) {

    this._handler = this._handler || {};
    // trans
    handler = utils.trans2Array(handler, _.isObject);
    // each
    handler.forEach((h) => {
      // alias/handler/method
      let alias   = h.alias,
          handle = h.handle,
          methods = utils.trans2Array(h.methods, _.isString);
      // alias
      alias = utils.exec((alias) ? alias : (handle.name || handle.identity));
      if (_.isString(alias)) {
        let checks = false;
        if (!_.isEmpty(methods)) {
          checks = {};
          methods.forEach((method) => {
            if (handle && _.isFunction(handle[method])) {
              checks[method] = true;
            } else {
              this.emit(utils.EVENT.ERROR, new Error('Invalid handler or method'));
            }
          });
        }
        this._handler[alias] = {origin: handle, methods: checks};
        this._addToRedis(alias, {id: this._id, host: this._host, port: this._port, methods: checks});
      }

    });
  }

  /**
   * init redis and register all handler
   * @private
   */
  _addToRedis(alias, data) {
    return this._cache.save(utils.REDIS_KEY({alias: alias, id: this._id}), data, utils.REDIS_TTL)
      .then(() => {
        setInterval(() => {
          this._cache.save(utils.REDIS_KEY({alias: alias, id: this._id}), data, utils.REDIS_TTL);
        }, 1000 * utils.REDIS_TTL);
      })
      .catch((err) => {
        this.emit(utils.EVENT.ERROR, err);
      });
  }

  /**
   * @returns {ThriftServer.host}
   */
  host() {
    return this._host;
  }

  /**
   * @returns {ThriftServer.port}
   */
  port() {
    return this._port;
  }

  /**
   * init thrift handler of this
   * @private
   */
  _initThriftHandler() {
    // inner msg handler
    let that = this;
    this._innerThriftProcessor = ThriftMsg;
    this._innerHandler = {
      call(cmsg, callback) {
        // get params
        let base    = cmsg.base,
            caller  = cmsg.call,
            handler = that._handler[caller.name];
        that.emit(utils.EVENT.LOG, JSON.stringify(cmsg));
        // set sender
        base.sender = that._id + '.' + that._host;
        // caller.
        if (handler && handler.origin[caller.method]) {
          // check permission
          if (handler.methods && !handler.methods[caller.method]) {
            callback(new ttypes.ThriftCallingException({err: 'method error', message: 'method forbidden'}), null);
          }
          let median = handler.origin[caller.method].apply(null, JSON.parse(caller.params));
          // maybe promise
          if (_.isFunction(median.then) && _.isFunction(median.catch)) {
            median.then((result) => {
                let rmsg = new ttypes.RMsg({
                  base: base,
                  res : JSON.stringify({
                    result: result
                  })
                });
                callback(null, rmsg);
              })
              .catch((err) => {
                callback(new ttypes.ThriftCallingException({err: err, message: err.message}), null);
              });
          }
          // sync
          else {
            callback(null, new ttypes.RMsg({
              base: base,
              res : JSON.stringify({
                result: median
              })
            }));
          }
        } else {
          // no handler
          callback(new ttypes.ThriftCallingException({
            err    : 'method error',
            message: 'Cannot find handler ' + caller.name + ' or method ' + caller.method
          }), null);
        }
      }
    };
  }
}

exports.ThriftServer = ThriftServer;

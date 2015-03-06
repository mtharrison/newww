var
  _ = require('lodash'),
  assert = require('assert'),
  bole = require('bole'),
  crypto = require('crypto'),
  Redis = require('redis-url'),
  Request = require('request');

var Cache = module.exports = function(opts) {
  assert(_.isObject(opts), 'you must pass an options object to the cache configuration');
  assert(_.isString(opts.redis), 'you must pass a redis url in `options.redis`');

  this.redis = Redis.connect(opts.redis);
  this.ttl = opts.ttl || 300; // seconds
  this.prefix = opts.prefix || 'cache:';
  this.logger = bole('cache');
};

Cache.prototype.fingerprint = function fingerprint(obj) {
  var cleaned = {};
  var keys = Object.keys(obj).sort();
  _.each(keys, function(k) {
    k = k.toLowerCase();
    cleaned[k] = obj[k];
  });

  // TODO: omit ttl

  var hash = crypto
    .createHash('md5')
    .update(JSON.stringify(cleaned))
    .digest('hex');
  return this.prefix + hash;
};

function safeparse(input) {
  try {
    return JSON.parse(input);
  } catch (ex) {
    return null;
  }
}

// callback or promise
Cache.prototype.get = function get(requestOpts, callback) {
  var _this = this
  assert(_.isObject(_this.redis), 'you must configure the redis client before using the cache.');
  assert(_.isObject(requestOpts), 'you must pass a Request-ready options object to cache.get()');

  var key = _this.fingerprint(requestOpts);
  _this.redis.get(key, function(err, value) {
    if (err) {
      _this.logger.error('problem getting ' + key + ' from redis @ ' + _this.redis);
      _this.logger.error(err);
    } else if (value) {
      value = safeparse(value);
    }

    if (value) return callback(null, value);

    Request(requestOpts, function(err, response, data) {
      if (err) return callback(err);

      var ttl = requestOpts.ttl || _this.ttl;
      _this.redis.setex(key, ttl, JSON.stringify(data), function(err, response) {
        if (err) {
          _this.logger.error('unable to cache ' + key + ' in redis @ ' + _this.redis);
          _this.logger.error(err);
        } else {
          _this.logger.info('cached ' + key);
        }
      });
      return callback(null, data);
    });
  });
};

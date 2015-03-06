var Code = require('code'),
  Lab = require('lab'),
  lab = exports.lab = Lab.script(),
  describe = lab.experiment,
  before = lab.before,
  after = lab.after,
  beforeEach = lab.beforeEach,
  afterEach = lab.afterEach,
  it = lab.test,
  expect = Code.expect,
  crypto = require('crypto'),
  sinon = require('sinon'),
  nock = require('nock');

nock.disableNetConnect();

var Cache = require('../lib/cache');
var cache;

describe('lib/cache.js', function() {

  beforeEach(function(done) {
    cache = new Cache({
      redis: 'redis://localhost:6379'
    })
    done();
  });

  it('constructor requires an options object', function(done) {
    function shouldThrow() {
      new Cache();
    }
    expect(shouldThrow).to.throw(/options/);
    done();
  });

  it('constructor requires a redis url option', function(done) {
    function shouldThrow() {
      new Cache({});
    }
    expect(shouldThrow).to.throw(/redis/);
    done();
  });

  it('contructor creates a redis client', function(done) {
    var cache = new Cache({
      redis: 'redis://localhost:6379'
    });
    expect(cache.redis).to.be.an.object();
    done();
  });

  it('contstructor respects the `ttl` option', function(done) {
    var cache = new Cache({
      redis: 'redis://localhost:6379',
      ttl: 123
    });
    expect(cache.ttl).to.equal(123);
    done();
  });

  it('constructor respects the `prefix` option', function(done) {
    var cache = new Cache({
      redis: 'redis://localhost:6379',
      prefix: "request:"
    });
    expect(cache.prefix).to.equal("request:");
    done();
  });

  describe("fingerprint", function() {

    it('returns an md5 hash prefixed by the key prefix', function(done) {
      var testKey = {foo: 'bar'};
      var expected = crypto.createHash('md5').update(JSON.stringify(testKey)).digest('hex');
      var generated = cache.fingerprint(testKey);

      expect(generated.indexOf(expected)).to.equal(6);
      expect(generated.indexOf('cache:')).to.equal(0);
      done();
    });

    it('returns the same value for the same input', function(done) {
      var key1 = {
        foo: 'bar',
        baz: 'qux'
      };
      var key2 = {
        baz: 'qux',
        foo: 'bar'
      };
      var gen1 = cache.fingerprint(key1);
      var gen2 = cache.fingerprint(key2);

      expect(gen1).to.equal(gen2);
      done();
    });
  });

  describe("get", function() {

    it('requires an options argument', function(done) {
      function shouldThrow() { cache.get(); }
      expect(shouldThrow).to.throw(/Request/);
      done();
    });

    it('calls fingerprint()', function(done) {
      sinon.spy(cache, 'fingerprint');

      nock("https://fingerprint.com").get("/").reply(200);
      var opts = {
        method: "get",
        url: 'https://fingerprint.com/'
      };

      cache.get(opts, function(err, data) {
        expect(cache.fingerprint.calledOnce).to.be.true();
        expect(cache.fingerprint.calledWith(opts)).to.be.true();
        cache.fingerprint.restore();
        done();
      });
    });

    it('checks redis for the presence of the data first', function(done) {
      sinon.spy(cache.redis, 'get');
      var opts = {
        url: 'https://google.com/'
      };
      var fingerprint = cache.fingerprint(opts);

      cache.get(opts, function(err, data) {
        expect(cache.redis.get.calledOnce).to.equal(true);
        expect(cache.redis.get.calledWith(fingerprint)).to.equal(true);
        cache.redis.get.restore();
        done();
      });
    });

    it('makes a request using the options argument if redis has no value', function(done) {

      sinon.stub(cache.redis, 'get').yields(null);

      var opts = {
        method: "get",
        url: 'https://google.com/searching'
      };

      var mock = nock("https://google.com")
        .get("/searching")
        .reply(200);

      cache.get(opts, function(err, data) {
        expect(cache.redis.get.calledOnce).to.equal(true);
        cache.redis.get.restore();
        mock.done();
        done();
      });
    });

    it('makes a request to the backing service if the redis value is garbage', function(done) {

      sinon.stub(cache.redis, 'get').yields(null, null);

      var opts = {
        method: "get",
        url: 'https://google.com/again'
      };

      var mock = nock("https://google.com")
        .get("/again")
        .reply(200);

      cache.get(opts, function(err, data) {
        expect(cache.redis.get.calledOnce).to.equal(true);
        cache.redis.get.restore();
        mock.done();
        done();
      });
    });

    it('gracefully handles a missing or error-returning redis', function(done) {

      sinon.stub(cache.redis, 'get').yields(Error("hello redis error"));
      sinon.spy(cache.logger, 'error');

      var opts = {
        url: 'https://logging.com/'
      };

      cache.get(opts, function(err, data) {
        expect(cache.logger.error.calledTwice).to.equal(true);
        expect(cache.logger.error.firstCall.calledWithMatch(/problem getting/)).to.equal(true);
        cache.logger.error.restore();
        cache.redis.get.restore();
        done();
      });
    });

    it('sets the value in redis after retrieval', function(done) {

      sinon.stub(cache.redis, 'get').yields(null, null);
      sinon.spy(cache.redis, 'setex');

      var opts = {
        method: "get",
        url: 'https://cache.com/hello'
      };
      var fingerprint = cache.fingerprint(opts);

      var mock = nock("https://cache.com")
        .get("/hello")
        .reply(200, "welcome to cache.com");

      cache.get(opts, function(err, data) {
        mock.done();
        expect(cache.redis.setex.calledOnce).to.equal(true);
        expect(cache.redis.setex.calledWithMatch(fingerprint)).to.equal(true);
        cache.redis.setex.restore();
        cache.redis.get.restore();
        done();
      });
    });

    it('respects the default TTL', function(done) {

      sinon.stub(cache.redis, 'get').yields(null, null);
      sinon.spy(cache.redis, 'setex');

      var opts = {
        method: "get",
        url: 'https://cache.com/hello-again'
      };

      var fingerprint = cache.fingerprint(opts);
      var mock = nock("https://cache.com")
        .get("/hello-again")
        .reply(200, "foo");

      cache.get(opts, function(err, data) {
        mock.done();
        expect(cache.redis.setex.called).to.equal(true);
        expect(cache.redis.setex.calledWith(fingerprint, 300)).to.equal(true);
        cache.redis.get.restore();
        cache.redis.setex.restore();
        done();
      });
    });

    it('responds with a promise if no callback is provided');
  });
});

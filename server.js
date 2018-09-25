const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const redis = require('redis');
const { name: packageName } = require('./package.json');
const { promisify } = require('util');
const { defaultTo } = require('lodash');
const assert = require('assert');
const bitcoin = require('bitcoin');
const { URL } = require('url');
const { safeFunction } = require('safep');

require('dotenv').config();

const REDIS_KEY_PREFIX = defaultTo(process.env.REDIS_KEY_PREFIX, `${packageName}_`);
const FAUCET_TTL = +defaultTo(process.env.FAUCET_TTL, 60 * 60 * 24);
const DRIP_AMOUNT = +defaultTo(process.env.DRIP_AMOUNT, 0.01);

const bitcoinUrl = new URL(process.env.BITCOIND_RPC_URL || 'bitcoin://user:pass@localhost:8332');

const bitcoinClient = new bitcoin.Client({
  host: bitcoinUrl.hostname || 'localhost',
  port: bitcoinUrl.port || 8332,
  user: bitcoinUrl.username || 'user',
  pass: bitcoinUrl.password || 'password',
});

const redisKey = _ => `${REDIS_KEY_PREFIX}._`;
const redisClient = redis.createClient(process.env.REDIS_URL);

for (const name of ['ttl', 'setnx', 'expire', 'del']) {
  redisClient[`${name}Async`] = promisify(redisClient[name].bind(redisClient));
}

const bitcoinCmdAsync = promisify(bitcoinClient.cmd.bind(bitcoinClient));
const bitcoinCmdSafe = safeFunction(bitcoinCmdAsync);

// const redisTtlAsync = promisify(redisClient.ttl.bind(redisClient));
// const redisSetnxAsync = promisify(redisClient.setnx.bind(redisClient));
// const redisExpireAsync = promisify(redisClient.expire.bind(redisClient));
// const redisDelAsync = promisify(redisClient.del.bind(redisClient));

const app = express();
app.enable('trust proxy');
app.use(express.static(path.join(__dirname, 'build')));
app.use(bodyParser.json());

// https://redislabs.com/ebook/part-2-core-concepts/chapter-6-application-components-in-redis/6-2-distributed-locking/6-2-5-locks-with-timeouts/
async function acquireLock(key, value, ttl) {
  const didSet = await redisClient.setnxAsync(key, value);
  const expire = () => redisClient.expireAsync(key, ttl);

  if (didSet) {
    await expire();
    return true;
  }

  const hasTtl = await redisClient.ttlAsync(key);

  if (!hasTtl) {
    await expire();
  }

  return false;
}

const wrapHandler = fn => (req, res, next) => fn(req, res).catch(next);

app.post(
  '/api/drip',
  wrapHandler(async (req, res) => {
    const { ip } = req;
    assert(ip, 'ip missing from request');

    const { address, recaptchaToken } = req.body;
    assert(address);

    const { isvalid: addressIsValid } = await bitcoinCmdAsync('validateaddress', address);

    if (!addressIsValid) {
      return res.status(400).send('Invalid Drivenet address');
    }

    const lockKey = redisKey(`lock.ip.${ip}`);
    const canReceiveDrip = await acquireLock(lockKey, ip, FAUCET_TTL);

    if (!canReceiveDrip) {
      return res.status(429).send('Cannot drip on this IP address again yet');
    }

    const [sendError, txhash] = await bitcoinCmdSafe('sendtoaddress', address, DRIP_AMOUNT);

    if (sendError) {
      if (sendError.message === 'Insufficient funds') {
        console.error(`ERROR Faucet is dry`);
        await redisClient.delAsync(lockKey);
        return res.status(500).send('Faucet is dry');
      }

      throw sendError;
    }

    assert(txhash);

    console.log(`Sent ${DRIP_AMOUNT} to ${address} (${ip})`);

    return res.send({ txhash, amount: DRIP_AMOUNT });
  })
);

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(process.env.PORT || 8080);

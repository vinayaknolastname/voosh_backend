import redis, { RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export const initRedis = async (): Promise<void> => {
  if (process.env.REDIS_URL) {
    let redisUrl = process.env.REDIS_URL;
    if (redisUrl.startsWith('redis://')) {
      redisUrl = redisUrl.replace('redis://', 'rediss://');
    }

    client = redis.createClient({
      url: redisUrl,
      socket: {
        tls: true,
        rejectUnauthorized: false,
      },
    });

    client.on('error', (err) => console.log('Redis Client Error', err));

    try {
      await client.connect();
      console.log('Connected to Redis');
    } catch (error) {
      console.log('Failed to connect to Redis, using in-memory fallback');
      client = null;
    }
  } else {
    console.log('No REDIS_URL provided, using in-memory fallback');
  }
};

export const getClient = (): RedisClientType | null => client;

export default {
  initRedis,
  getClient,
};


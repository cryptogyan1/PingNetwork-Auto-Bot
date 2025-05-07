const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const envPath = path.resolve(__dirname, '.env');
let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m"
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`   Ping Network Multi-Bot - Airdrop Insiders`);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

function getEnvVars() {
  const env = fs.readFileSync(envPath, 'utf8');
  const users = [];

  const userMatches = env.match(/USER_ID_\d+=.*/g);
  if (!userMatches) return [];

  userMatches.forEach((line, index) => {
    const [key, userId] = line.split('=').map(s => s.trim());
    const idNumber = key.split('_')[2];
    const deviceKey = `DEVICE_ID_${idNumber}`;
    let deviceIdMatch = env.match(new RegExp(`${deviceKey}=.*`, 'g'));
    let deviceId = deviceIdMatch ? deviceIdMatch[0].split('=')[1].trim() : null;

    if (!deviceId) {
      deviceId = uuidv4();
      envContent += `\n${deviceKey}=${deviceId}`;
    }

    users.push({
      userId,
      deviceId,
      deviceKey
    });
  });

  // Save any newly generated DEVICE_IDs
  fs.writeFileSync(envPath, envContent.trim());
  return users;
}

function getRandomZoneId() {
  return Math.floor(Math.random() * 6).toString();
}

async function sendAnalyticsEvent(config, logger) {
  try {
    logger.loading('Sending analytics event...');
    const payload = {
      client_id: config.device_id,
      events: [{
        name: 'connect_clicked',
        params: {
          session_id: Date.now().toString(),
          engagement_time_msec: 100,
          zone: config.proxy.zoneId
        }
      }]
    };
    await axios.post('https://www.google-analytics.com/mp/collect?measurement_id=G-M0F9F7GGW0&api_secret=tdSjjplvRHGSEpXPfPDalA', payload, {
      headers: config.headers
    });
    logger.success('Analytics event sent successfully');
  } catch (error) {
    logger.error(`Failed to send analytics: ${error.message}`);
  }
}

function runBotInstance({ userId, deviceId }) {
  const zoneId = getRandomZoneId();
  const userAgent = new UserAgent({ deviceCategory: 'desktop' });
  const UA_STRING = userAgent.toString();

  const CONFIG = {
    wsUrl: `wss://ws.pingvpn.xyz/pingvpn/v1/clients/${userId}/events`,
    user_id: userId,
    device_id: deviceId,
    proxy: { zoneId },
    headers: {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,id;q=0.8',
      'content-type': 'text/plain;charset=UTF-8',
      'sec-ch-ua': userAgent.data.userAgent,
      'sec-ch-ua-mobile': userAgent.data.isMobile ? '?1' : '?0',
      'sec-ch-ua-platform': `"${userAgent.data.platform}"`,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'none',
      'sec-fetch-storage-access': 'active',
      'sec-gpc': '1'
    }
  };

  const WS_HEADERS = {
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'user-agent': UA_STRING
  };

  logger.step(`Starting bot for USER_ID=${userId}`);
  logger.info(`Using DEVICE_ID=${deviceId}`);
  logger.info(`Using User-Agent: ${UA_STRING}`);
  logger.info(`Zone ID: ${zoneId}`);

  function connectWebSocket() {
    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 5000;
    let isAlive = false;

    function establishConnection() {
      logger.loading(`Connecting WebSocket for USER_ID=${userId}`);
      ws = new WebSocket(CONFIG.wsUrl, { headers: WS_HEADERS });

      ws.on('open', () => {
        logger.success(`WebSocket connected for USER_ID=${userId}`);
        reconnectAttempts = 0;
        isAlive = true;
        sendAnalyticsEvent(CONFIG, logger);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          logger.info(`[${userId}] Message: ${JSON.stringify(message)}`);
          isAlive = true;

          if (message.type === 'client_points') {
            logger.success(`Points: ${message.data.amount} (TX: ${message.data.last_transaction_id})`);
          } else if (message.type === 'referral_points') {
            logger.success(`Referral Points: ${message.data.amount} (TX: ${message.data.last_transaction_id})`);
          }
        } catch (error) {
          logger.error(`Error parsing message: ${error.message}`);
        }
      });

      ws.on('close', () => {
        logger.warn(`WebSocket closed for USER_ID=${userId}`);
        isAlive = false;
        attemptReconnect();
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
        isAlive = false;
      });
    }

    function sendPing() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
        logger.step(`[${userId}] Sent ping`);
      }
    }

    setInterval(() => {
      if (!isAlive && ws && ws.readyState !== WebSocket.CLOSED) {
        logger.warn(`[${userId}] No heartbeat, closing WebSocket...`);
        ws.close();
      } else {
        sendPing();
      }
    }, 60000);

    function attemptReconnect() {
      if (reconnectAttempts >= maxReconnectAttempts) {
        logger.error(`[${userId}] Max reconnect attempts reached.`);
        return;
      }
      const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
      logger.warn(`[${userId}] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts + 1})`);
      setTimeout(() => {
        reconnectAttempts++;
        establishConnection();
      }, delay);
    }

    establishConnection();
  }

  connectWebSocket();
}

// Start all bots
(async () => {
  logger.banner();
  const users = getEnvVars();
  if (users.length === 0) {
    logger.error("No USER_ID_X entries found in .env file.");
    process.exit(1);
  }

  users.forEach(runBotInstance);
})();

process.on('SIGINT', () => {
  logger.warn('Shutting down all bots...');
  process.exit(0);
});

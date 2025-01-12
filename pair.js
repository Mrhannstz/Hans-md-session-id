const fs = require('fs');
const { makeid } = require('./id');
const pino = require('pino');
const {
  default: Gifted_Tech,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
} = require('maher-zubair-baileys');

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send({ error: 'Method not allowed' });
  }

  const id = makeid();
  let num = req.query.number;

  if (!num || !/^\d+$/.test(num)) {
    return res.status(400).send({ error: 'Invalid number format' });
  }

  async function generatePairCode() {
    const { state, saveCreds } = await useMultiFileAuthState(`/tmp/${id}`);

    try {
      const tech = Gifted_Tech({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: ['Chrome (Linux)', '', ''],
      });

      if (!tech.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, '');
        const code = await tech.requestPairingCode(num);

        if (!res.headersSent) {
          return res.status(200).send({ code });
        }
      }

      tech.ev.on('creds.update', saveCreds);

      tech.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          const sessionData = fs.readFileSync(`/tmp/${id}/creds.json`);
          const b64data = Buffer.from(sessionData).toString('base64');

          await tech.sendMessage(tech.user.id, {
            text: `Session connected: ${b64data}`,
          });

          await tech.ws.close();
          removeFile(`/tmp/${id}`);
        } else if (connection === 'close' && lastDisconnect?.error) {
          console.error('Connection error:', lastDisconnect.error);
          await delay(10000);
          generatePairCode();
        }
      });
    } catch (err) {
      console.error('Error during pairing:', err.message);
      removeFile(`/tmp/${id}`);
      if (!res.headersSent) {
        res.status(500).send({ error: 'Service unavailable' });
      }
    }
  }

  await generatePairCode();
}

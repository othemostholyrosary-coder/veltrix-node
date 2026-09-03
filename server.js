// server.js — Veltrix node: Mistral-backed, task-routed, x402-payable, Bazaar-discoverable
// Run in Termux: node server.js
// Requires: npm install express node-fetch dotenv @x402/express @x402/core @x402/evm @x402/extensions

const express = require('express');
const fetch = require('node-fetch'); // if on Node 18+, you can use global fetch instead
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactEvmScheme } = require('@x402/evm/exact/server');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const WALLET_ADDRESS = process.env.WALLET_ADDRESS; // your Base wallet, receives USDC
const NETWORK = process.env.X402_NETWORK || 'eip155:84532'; // Base Sepolia (testnet) by default
const PRICE = process.env.X402_PRICE || '$0.005';

if (!MISTRAL_API_KEY) {
  console.error('Missing MISTRAL_API_KEY in .env — get one free at https://console.mistral.ai/');
  process.exit(1);
}
if (!WALLET_ADDRESS) {
  console.error('Missing WALLET_ADDRESS in .env — your Base wallet address that receives USDC payments');
  process.exit(1);
}

// --- x402 payment + Bazaar discovery setup ---------------------------------
// PayAI's facilitator (Base Sepolia + mainnet, Solana, and more) auto-lists
// any endpoint pointed at it in the x402 Bazaar — no signup, no API key.
const facilitatorClient = new HTTPFacilitatorClient({ url: 'https://facilitator.payai.network' });
const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const routes = {
  'POST /query': {
    accepts: {
      scheme: 'exact',
      price: PRICE,
      network: NETWORK,
      payTo: WALLET_ADDRESS,
    },
    description: 'Task-routed Mistral endpoint: extract, summarize, classify, convert. Strict JSON output only.',
    mimeType: 'application/json',
    extensions: {
      bazaar: {
        discoverable: true,
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', enum: ['extract', 'summarize', 'classify', 'convert'], description: 'Which capability to invoke' },
            text: { type: 'string', description: 'The input text to process' },
            schema: { type: 'string', description: '(extract only) description of desired JSON fields' },
            domain: { type: 'string', description: '(summarize only) topic domain, e.g. "legal"' },
            max_bullets: { type: 'number', description: '(summarize only) number of bullets, default 5' },
            labels: { type: 'array', items: { type: 'string' }, description: '(classify only) allowed label set' },
            target_format: { type: 'string', description: '(convert only) desired output format, e.g. "cron expression"' }
          },
          required: ['task', 'text']
        },
        outputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            result: { type: 'object' },
            usage: { type: 'object' }
          }
        }
      }
    }
  }
};

app.use(paymentMiddleware(routes, resourceServer));
app.use(express.json());

// Health check — free, no payment gate
app.get('/', (req, res) => {
  res.json({ status: 'alive', node: 'veltrix', model: MISTRAL_MODEL, network: NETWORK, price: PRICE });
});

// --- llms.txt — plain-text discovery file some agent crawlers check directly
app.get('/llms.txt', (req, res) => {
  res.type('text/plain').send(
`# Veltrix Node

> Task-routed AI text endpoint for agents. Pay-per-call via x402 (USDC on Base).

## What it does
POST /query with a JSON body: {"task": "extract" | "summarize" | "classify" | "convert", "text": "..."}
Returns strict JSON output only — no prose, no markdown. Price: ${PRICE} per call.

## Tasks
- extract: pull structured data from text into JSON (pass "schema" describing desired fields)
- summarize: condense text into bullet points (pass "domain", "max_bullets")
- classify: label text against a fixed set (pass "labels")
- convert: transform text into a target format (pass "target_format")

## Machine-readable spec
${req.protocol}://${req.get('host')}/openapi.json

## Payment
x402 protocol, network: ${NETWORK}, facilitator: PayAI (facilitator.payai.network)
`
  );
});
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'Veltrix Node',
    description: 'Task-routed AI text endpoint. Extract, summarize, classify, or convert text using Mistral Small. Strict JSON output. Pay-per-call via x402 on Base.',
    url: `https://${req.get('host')}`,
    version: '1.0.0',
    provider: {
      organization: 'Veltrix',
      contact: 'othemostholyrosary@gmail.com'
    },
    capabilities: {
      streaming: false,
      pushNotifications: false
    },
    skills: [
      { name: 'extract', description: 'Pull structured JSON fields from text. Pass "schema" describing desired fields.' },
      { name: 'summarize', description: 'Condense text into bullet points. Pass "domain" and "max_bullets".' },
      { name: 'classify', description: 'Label text against a fixed set. Pass "labels" array.' },
      { name: 'convert', description: 'Transform text into a target format. Pass "target_format".' }
    ],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    payment: {
      protocol: 'x402',
      network: NETWORK,
      price: PRICE,
      asset: 'USDC',
      facilitator: 'https://facilitator.payai.network'
    },
    endpoints: {
      query: { method: 'POST', path: '/query' },
      openapi: { method: 'GET', path: '/openapi.json' },
      llms: { method: 'GET', path: '/llms.txt' }
    }
  });
});
    
// --- OpenAPI discovery document -------------------------------------------
// x402scan and similar crawlers require this at /openapi.json before they'll
// index a resource — the live 402 response alone isn't enough for them.
app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'Veltrix Node',
      description: 'Task-routed Mistral endpoint: extract, summarize, classify, convert. Strict JSON output only.',
      version: '1.0.0',
      contact: { email: 'othemostholyrosary@gmail.com' },
      'x-guidance': 'Call POST /query with a JSON body containing "task" (one of: extract, summarize, classify, convert) and "text". Add task-specific fields as needed: "schema" for extract, "domain"/"max_bullets" for summarize, "labels" for classify, "target_format" for convert. The response is always strict JSON — no prose, no markdown. Pay the quoted price via x402 (USDC on Base) to receive a result; unpaid calls receive 402 with payment requirements.'
    },
    externalDocs: {
      url: 'https://veltrix-node.onrender.com/openapi.json',
      description: 'This discovery document also serves as the endpoint documentation.'
    },
    servers: [{ url: `https://${req.get('host')}` }],
    paths: {
      '/query': {
        post: {
          operationId: 'query',
          summary: 'Run a task (extract, summarize, classify, or convert) via Mistral',
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: PRICE.replace('$', '') },
            protocols: [{ x402: {} }]
          },
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    task: { type: 'string', enum: ['extract', 'summarize', 'classify', 'convert'] },
                    text: { type: 'string' },
                    schema: { type: 'string', description: '(extract only)' },
                    domain: { type: 'string', description: '(summarize only)' },
                    max_bullets: { type: 'number', description: '(summarize only)' },
                    labels: { type: 'array', items: { type: 'string' }, description: '(classify only)' },
                    target_format: { type: 'string', description: '(convert only)' }
                  },
                  required: ['task', 'text']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      task: { type: 'string' },
                      result: { type: 'object' },
                      usage: { type: 'object' }
                    }
                  }
                }
              }
            },
            '402': { description: 'Payment Required' }
          }
        }
      }
    }
  });
});

// --- Task registry -----------------------------------------------------
const TASKS = {
  extract: {
    buildMessages: ({ text, schema }) => [
      { role: 'system', content: `You extract structured data from text. Return ONLY valid JSON matching this schema description, no prose, no markdown fences: ${schema}` },
      { role: 'user', content: text }
    ]
  },
  summarize: {
    buildMessages: ({ text, domain, max_bullets = 5 }) => [
      { role: 'system', content: `You summarize ${domain || 'general'} text into exactly ${max_bullets} concise bullet points. Return ONLY JSON: {"bullets": ["...", ...]}. No prose outside the JSON.` },
      { role: 'user', content: text }
    ]
  },
  classify: {
    buildMessages: ({ text, labels }) => [
      { role: 'system', content: `Classify the input into exactly one of these labels: ${JSON.stringify(labels)}. Return ONLY JSON: {"label": "...", "confidence": 0.0-1.0}. No prose.` },
      { role: 'user', content: text }
    ]
  },
  convert: {
    buildMessages: ({ text, target_format }) => [
      { role: 'system', content: `Convert the input into ${target_format}. Return ONLY JSON: {"output": "..."}. No prose, no explanation.` },
      { role: 'user', content: text }
    ]
  }
};

// Main endpoint — payment already verified by middleware before this runs
app.post('/query', async (req, res) => {
  const { task } = req.body;

  if (!task || !TASKS[task]) {
    return res.status(400).json({ error: `Body must include a valid "task": ${Object.keys(TASKS).join(', ')}` });
  }

  let messages;
  try {
    messages = TASKS[task].buildMessages(req.body);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid parameters for this task', detail: err.message });
  }

  try {
    const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        messages,
        response_format: { type: 'json_object' }
      })
    });

    if (!mistralRes.ok) {
      const errText = await mistralRes.text();
      return res.status(502).json({ error: 'Mistral API error', detail: errText });
    }

    const data = await mistralRes.json();
    const raw = data.choices?.[0]?.message?.content ?? null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON output', raw });
    }

    res.json({ task, result: parsed, usage: data.usage ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error calling Mistral', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Veltrix node listening on http://localhost:${PORT}`);
  console.log(`Network: ${NETWORK} | Price: ${PRICE} | Wallet: ${WALLET_ADDRESS}`);
});
  

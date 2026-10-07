const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || '0.0.0.0';
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || '').trim();
const MODEL = 'openrouter/free';
const MAX_BODY = 16 * 1024 * 1024;

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'index.html');

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function sendText(res, status, body, contentType='text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload muito grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('').trim();
  }
  return '';
}

function cleanJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.startsWith('```')) {
    return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw;
}

function normalizeScannerResult(raw) {
  try {
    const obj = typeof raw === 'object' && raw ? raw : JSON.parse(cleanJsonText(raw));
    return {
      is_food: obj.is_food === true,
      ingredients: Array.isArray(obj.ingredients) ? obj.ingredients.map(v => String(v || '').trim()).filter(Boolean).slice(0, 20) : [],
      recipe_name: String(obj.recipe_name || '').trim().slice(0, 200),
      recipe: String(obj.recipe || '').trim().slice(0, 5000),
      calories_per_serving: Number.isFinite(Number(obj.calories_per_serving)) ? Math.max(0, Math.round(Number(obj.calories_per_serving))) : 0,
      servings: Number.isFinite(Number(obj.servings)) ? Math.max(0, Math.round(Number(obj.servings))) : 0,
      note: String(obj.note || '').trim().slice(0, 1000)
    };
  } catch {
    return null;
  }
}

async function openRouterChat(messages, extra = {}) {
  if (!OPENROUTER_API_KEY) {
    const err = new Error('OPENROUTER_API_KEY não configurada no servidor.');
    err.status = 401;
    throw err;
  }

  const payload = {
    model: MODEL,
    messages,
    temperature: extra.temperature ?? 0.4,
    max_tokens: extra.max_tokens ?? 900,
    ...extra.body
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_APP_URL || '',
      'X-Title': 'Rotina no Controle'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || `OpenRouter retornou HTTP ${response.status}.`);
    err.status = response.status;
    err.provider = data?.error?.metadata || '';
    throw err;
  }
  return data;
}

async function handleAssistant(req, res) {
  const body = await readJson(req);
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content || '').trim() }))
    .filter(m => m.content)
    .slice(-20);

  if (!messages.length) return sendJson(res, 400, { ok: false, error: { message: 'Envie uma mensagem.' } });

  const system = String(body.system || 'Você é o assistente do Rotina no Controle. Responda em português do Brasil de forma prática e objetiva.').slice(0, 5000);
  const data = await openRouterChat([
    { role: 'system', content: system },
    ...messages
  ], { temperature: 0.5, max_tokens: 1000 });

  const reply = extractText(data?.choices?.[0]?.message?.content);
  if (!reply) throw Object.assign(new Error('A OpenRouter não retornou texto.'), { status: 502 });

  return sendJson(res, 200, {
    ok: true,
    reply,
    model: data?.model || MODEL
  });
}

async function handleScanner(req, res) {
  const body = await readJson(req);
  const image = String(body.image_data_url || '').trim();
  const prompt = String(body.prompt || '').trim();
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(image)) {
    return sendJson(res, 400, { ok: false, error: { message: 'Imagem inválida ou ausente.' } });
  }
  if (!prompt) return sendJson(res, 400, { ok: false, error: { message: 'Prompt do Scanner ausente.' } });
  if (image.length > 12 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: { message: 'Imagem muito grande.' } });

  const data = await openRouterChat([
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt.slice(0, 12000) },
        { type: 'image_url', image_url: { url: image } }
      ]
    }
  ], {
    temperature: 0.2,
    max_tokens: 900,
    body: { response_format: { type: 'json_object' } }
  });

  const raw = extractText(data?.choices?.[0]?.message?.content);
  const result = normalizeScannerResult(raw);
  if (!result) throw Object.assign(new Error('A OpenRouter respondeu, mas o Scanner recebeu um JSON inválido.'), { status: 502 });

  return sendJson(res, 200, {
    ok: true,
    result,
    model: data?.model || MODEL
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let filePath;
  if (url.pathname === '/' || url.pathname === '/index.html') filePath = HTML_FILE;
  else {
    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^\.{2}[\\/]/, '');
    filePath = path.join(ROOT, safePath);
    if (!filePath.startsWith(ROOT)) return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        provider: 'OpenRouter',
        model: MODEL,
        configured: Boolean(OPENROUTER_API_KEY),
        mode: 'free-models'
      });
    }
    if (url.pathname === '/api/assistant' && req.method === 'POST') return await handleAssistant(req, res);
    if (url.pathname === '/api/scanner' && req.method === 'POST') return await handleScanner(req, res);
    return serveStatic(req, res);
  } catch (error) {
    console.error('[Rotina no Controle]', error);
    const status = Number(error?.status) || 500;
    return sendJson(res, status, {
      ok: false,
      error: {
        message: error?.message || 'Erro interno no servidor.'
      }
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Rotina no Controle online em http://${HOST}:${PORT}`);
  console.log(`OpenRouter configurada: ${OPENROUTER_API_KEY ? 'SIM' : 'NÃO'}`);
  console.log(`Modelo: ${MODEL}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import archiver from 'archiver';
import { extensionFromUrl, parseWeChatArticle } from './lib/parser.js';

const app = express();
const PORT = Number(process.env.PORT) || 4173;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNING_SECRET = process.env.SIGNING_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_ARTICLE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 50 * 1024 * 1024;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isArticleHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'mp.weixin.qq.com' || host === 'weixin.qq.com';
}

function isResourceHost(hostname) {
  const host = hostname.toLowerCase();
  return [
    'qpic.cn', 'qlogo.cn', 'weixin.qq.com', 'qq.com', 'gtimg.com',
    'wxqcloud.qq.com', 'wxaurl.cn'
  ].some(domain => host === domain || host.endsWith(`.${domain}`));
}

function safeUrl(raw, hostValidator) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('链接格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 链接');
  if (!hostValidator(url.hostname)) throw new Error('该链接不在允许的微信资源域名范围内');
  return url;
}

async function fetchWithValidatedRedirects(rawUrl, hostValidator, options = {}) {
  let current = safeUrl(rawUrl, hostValidator);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    current = safeUrl(new URL(location, current).toString(), hostValidator);
  }
  throw new Error('重定向次数过多');
}

function sign(url) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(url).digest('base64url');
}

function validToken(url, token = '') {
  const expected = sign(url);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function fileExtension(contentType = '', url = '') {
  const fromUrl = extensionFromUrl(url);
  if (fromUrl) return fromUrl;
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'application/pdf': 'pdf', 'application/zip': 'zip'
  };
  return map[contentType.split(';')[0].toLowerCase()] || 'bin';
}

function sanitizeFilename(value = 'resource') {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').slice(0, 100) || 'resource';
}

function contentDisposition(filename, inline = false) {
  const safe = sanitizeFilename(filename).replace(/[^ -~]/g, '_').replace(/"/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

class ByteLimit extends Transform {
  constructor(limit) { super(); this.limit = limit; this.total = 0; }
  _transform(chunk, encoding, callback) {
    this.total += chunk.length;
    if (this.total > this.limit) callback(new Error('资源文件超过 50 MB 限制'));
    else callback(null, chunk);
  }
}

function resourceResponse(item) {
  const token = sign(item.url);
  const query = new URLSearchParams({ url: item.url, token, filename: item.name });
  return {
    ...item,
    token,
    previewUrl: item.type === 'image' || item.type === 'head' || item.type === 'card'
      ? `/api/resource?${query}&inline=1`
      : '',
    downloadUrl: `/api/resource?${query}`
  };
}

app.post('/api/parse', async (req, res) => {
  try {
    const articleUrl = safeUrl(String(req.body?.url || ''), isArticleHost);
    const response = await fetchWithValidatedRedirects(articleUrl, isArticleHost, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 MicroMessenger/8.0',
        'accept-language': 'zh-CN,zh;q=0.9',
        accept: 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`微信页面返回了 ${response.status}`);
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > MAX_ARTICLE_BYTES) throw new Error('文章页面过大');
    const html = await response.text();
    if (Buffer.byteLength(html) > MAX_ARTICLE_BYTES) throw new Error('文章页面过大');
    if (/环境异常|访问过于频繁|请在微信客户端打开/i.test(html) && !/js_content/i.test(html)) {
      throw new Error('微信暂时拦截了本次访问，请稍后重试或更换网络');
    }
    const parsed = parseWeChatArticle(html, articleUrl.toString());
    const resources = parsed.resources.filter(item => {
      try { return isResourceHost(new URL(item.url).hostname); } catch { return false; }
    }).map(resourceResponse);
    const counts = Object.fromEntries(Object.keys(parsed.counts).map(type => [type, resources.filter(item => item.type === type).length]));
    res.json({ ...parsed, resources, counts, total: resources.length });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';
    res.status(400).json({ error: timedOut ? '请求微信文章超时，请稍后重试' : error.message || '解析失败' });
  }
});

app.get('/api/resource', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    if (!validToken(url, String(req.query.token || ''))) return res.status(403).json({ error: '下载签名已失效，请重新解析文章' });
    safeUrl(url, isResourceHost);
    const response = await fetchWithValidatedRedirects(url, isResourceHost, {
      headers: { referer: 'https://mp.weixin.qq.com/', 'user-agent': 'Mozilla/5.0 Chrome/131 Safari/537.36' },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok || !response.body) throw new Error(`资源服务器返回了 ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_RESOURCE_BYTES) throw new Error('资源文件超过 50 MB 限制');
    const type = response.headers.get('content-type') || 'application/octet-stream';
    let filename = sanitizeFilename(String(req.query.filename || 'resource'));
    if (!path.extname(filename)) filename += `.${fileExtension(type, url)}`;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', contentDisposition(filename, req.query.inline === '1'));
    if (length) res.setHeader('Content-Length', String(length));
    Readable.fromWeb(response.body).pipe(new ByteLimit(MAX_RESOURCE_BYTES)).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(400).json({ error: error.message || '资源下载失败' });
    else res.destroy(error);
  }
});

app.post('/api/download', async (req, res) => {
  const resources = Array.isArray(req.body?.resources) ? req.body.resources.slice(0, 100) : [];
  if (!resources.length) return res.status(400).json({ error: '请至少选择一个资源' });
  const valid = resources.filter(item => item?.url && validToken(item.url, String(item.token || '')));
  if (!valid.length) return res.status(403).json({ error: '资源签名已失效，请重新解析文章' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', contentDisposition('公众号文章资源.zip'));
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', error => res.destroy(error));
  archive.pipe(res);

  try {
    for (const item of valid) {
      safeUrl(item.url, isResourceHost);
      const response = await fetchWithValidatedRedirects(item.url, isResourceHost, {
        headers: { referer: 'https://mp.weixin.qq.com/', 'user-agent': 'Mozilla/5.0 Chrome/131 Safari/537.36' },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok || !response.body) continue;
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_RESOURCE_BYTES) continue;
      const name = sanitizeFilename(item.name || `resource.${fileExtension(response.headers.get('content-type') || '', item.url)}`);
      archive.append(Readable.fromWeb(response.body).pipe(new ByteLimit(MAX_RESOURCE_BYTES)), { name });
    }
    await archive.finalize();
  } catch (error) {
    archive.abort();
    if (!res.headersSent) res.status(400).json({ error: error.message || '打包下载失败' });
    else res.destroy(error);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((req, res) => {
  if (req.method === 'GET') res.sendFile(path.join(__dirname, 'public', 'index.html'));
  else res.status(404).json({ error: '接口不存在' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`WeGet 已启动：http://localhost:${PORT}`));
}

export { app, isArticleHost, isResourceHost };

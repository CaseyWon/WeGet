import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extensionFromUrl, parseWeChatArticle } from './parser.js';
import { createSigner, isArticleHost, isResourceHost, safeUrl, sanitizeFilename } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(__dirname, 'renderer');
const MAX_ARTICLE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 50 * 1024 * 1024;
const { sign, verify } = createSigner();

protocol.registerSchemesAsPrivileged([
  { scheme: 'weget-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'weget-resource', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

class ByteLimit extends Transform {
  constructor(limit) { super(); this.limit = limit; this.total = 0; }
  _transform(chunk, encoding, callback) {
    this.total += chunk.length;
    if (this.total > this.limit) callback(new Error('资源文件超过 50 MB 限制'));
    else callback(null, chunk);
  }
}

function assertTrustedSender(event) {
  if (!event.senderFrame?.url?.startsWith('weget-app://app/')) throw new Error('拒绝来自未知页面的请求');
}

async function fetchWithValidatedRedirects(rawUrl, validator, options = {}) {
  let current = safeUrl(rawUrl, validator);
  for (let count = 0; count <= 5; count += 1) {
    const response = await fetch(current, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    current = safeUrl(new URL(location, current).toString(), validator);
  }
  throw new Error('重定向次数过多');
}

// 首次解析要先做 DNS + TLS + 下载整页：实测冷启动可达 12s 以上（文章页约 3.5 MB）。
// 原来的 15s 超时太紧，网络稍抖就失败，所以放宽到 45s，并对超时自动重试一次。
const ARTICLE_TIMEOUT_MS = 45_000;
const ARTICLE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 MicroMessenger/8.0',
  'accept-language': 'zh-CN,zh;q=0.9',
  accept: 'text/html,application/xhtml+xml'
};

async function fetchArticle(articleUrl) {
  const attempt = () => fetchWithValidatedRedirects(articleUrl, isArticleHost, {
    headers: ARTICLE_HEADERS,
    signal: AbortSignal.timeout(ARTICLE_TIMEOUT_MS)
  });
  try {
    return await attempt();
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error;
    return attempt(); // 冷启动超时后重试一次
  }
}

function previewUrl(url) {
  return `weget-resource://asset/view?url=${encodeURIComponent(url)}&token=${encodeURIComponent(sign(url))}`;
}

function fileExtension(contentType = '', url = '') {
  const fromUrl = extensionFromUrl(url);
  if (fromUrl) return fromUrl;
  const types = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'application/pdf': 'pdf', 'application/zip': 'zip'
  };
  return types[contentType.split(';')[0].toLowerCase()] || 'bin';
}

// 微信文章 HTML 里的图片给的是压缩地址：路径末段是压缩标记（如 /640）。
// 把它改成 /0 就能拿到原图（2026-10 实测 8 张图 8/8 成功，宽度平均 +16%，1080→1280）。
// 只对腾讯图床生效；拿不到原图时自动回退到文章里给出的地址。
function originalImageUrl(value) {
  try {
    const parsed = new URL(value);
    if (!/(^|\.)qpic\.cn$/i.test(parsed.hostname)) return '';
    const segments = parsed.pathname.split('/');
    const last = segments[segments.length - 1];
    if (!/^\d+$/.test(last) || last === '0') return '';
    segments[segments.length - 1] = '0';
    parsed.pathname = segments.join('/');
    return parsed.toString();
  } catch { return ''; }
}

async function requestResource(url) {
  const response = await fetchWithValidatedRedirects(url, isResourceHost, {
    headers: { referer: 'https://mp.weixin.qq.com/', 'user-agent': 'Mozilla/5.0 Chrome/131 Safari/537.36' },
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok || !response.body) throw new Error(`资源服务器返回了 ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_RESOURCE_BYTES) throw new Error('资源文件超过 50 MB 限制');
  return response;
}

async function fetchResource(item) {
  const url = String(item?.url || '');
  if (!verify(url, String(item?.token || ''))) throw new Error('资源签名已失效，请重新解析文章');
  safeUrl(url, isResourceHost);
  const original = originalImageUrl(url);
  if (original) {
    try { return await requestResource(original); }
    catch { /* 原图不可用时回退到压缩地址 */ }
  }
  return requestResource(url);
}

async function replaceWithTemp(tempPath, finalPath) {
  await rm(finalPath, { force: true });
  await rename(tempPath, finalPath);
}

async function createMainWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 980, minHeight: 680,
    show: false, backgroundColor: '#f3f1e9',
    title: 'WeGet Desktop', titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f3f1e9', symbolColor: '#171714', height: 48 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, devTools: !app.isPackaged
    }
  });

  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  await win.loadURL('weget-app://app/index.html');
}

function registerProtocols() {
  protocol.handle('weget-app', request => {
    const url = new URL(request.url);
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const candidate = path.resolve(rendererRoot, `.${requested}`);
    if (!candidate.startsWith(`${rendererRoot}${path.sep}`) && candidate !== rendererRoot) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(candidate).toString());
  });

  protocol.handle('weget-resource', async request => {
    try {
      const requestUrl = new URL(request.url);
      const url = requestUrl.searchParams.get('url') || '';
      const token = requestUrl.searchParams.get('token') || '';
      if (!verify(url, token)) return new Response('Forbidden', { status: 403 });
      safeUrl(url, isResourceHost);
      const response = await fetchWithValidatedRedirects(url, isResourceHost, {
        headers: { referer: 'https://mp.weixin.qq.com/', 'user-agent': 'Mozilla/5.0 Chrome/131 Safari/537.36' },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok || !response.body) return new Response('Unavailable', { status: 502 });
      if (Number(response.headers.get('content-length')) > MAX_RESOURCE_BYTES) return new Response('Too large', { status: 413 });
      return new Response(response.body, {
        status: 200,
        headers: {
          'content-type': response.headers.get('content-type') || 'application/octet-stream',
          'cache-control': 'private, max-age=3600'
        }
      });
    } catch { return new Response('Unavailable', { status: 502 }); }
  });
}

function registerIpc() {
  ipcMain.handle('clipboard:read', event => { assertTrustedSender(event); return clipboard.readText(); });

  ipcMain.handle('article:parse', async (event, payload) => {
    assertTrustedSender(event);
    const articleUrl = safeUrl(payload?.url, isArticleHost);
    const response = await fetchArticle(articleUrl);
    if (!response.ok) throw new Error(`微信页面返回了 ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_ARTICLE_BYTES) throw new Error('文章页面过大');
    const html = await response.text();
    if (Buffer.byteLength(html) > MAX_ARTICLE_BYTES) throw new Error('文章页面过大');
    if (/环境异常|访问过于频繁|请在微信客户端打开/i.test(html) && !/js_content/i.test(html)) {
      throw new Error('微信暂时拦截了本次访问，请稍后重试或更换网络');
    }
    const parsed = parseWeChatArticle(html, articleUrl.toString());
    const resources = parsed.resources.filter(item => {
      try { return isResourceHost(new URL(item.url).hostname); } catch { return false; }
    }).map(item => ({
      ...item, token: sign(item.url),
      previewUrl: ['head', 'card', 'image'].includes(item.type) ? previewUrl(item.url) : ''
    }));
    const counts = Object.fromEntries(Object.keys(parsed.counts).map(type => [type, resources.filter(item => item.type === type).length]));
    return { ...parsed, resources, counts, total: resources.length };
  });

  ipcMain.handle('article:open-source', async (event, payload) => {
    assertTrustedSender(event);
    const url = safeUrl(payload?.url, isArticleHost);
    await shell.openExternal(url.toString());
    return { ok: true };
  });

  ipcMain.handle('resource:save', async (event, item) => {
    assertTrustedSender(event);
    const defaultName = sanitizeFilename(item?.name || 'resource');
    const chosen = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '保存资源', defaultPath: path.join(app.getPath('downloads'), defaultName),
      buttonLabel: '保存'
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const response = await fetchResource(item);
    let finalPath = chosen.filePath;
    if (!path.extname(finalPath)) finalPath += `.${fileExtension(response.headers.get('content-type') || '', item.url)}`;
    await mkdir(path.dirname(finalPath), { recursive: true });
    const tempPath = `${finalPath}.part-${process.pid}`;
    try {
      await pipeline(Readable.fromWeb(response.body), new ByteLimit(MAX_RESOURCE_BYTES), createWriteStream(tempPath));
      await replaceWithTemp(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return { canceled: false, path: finalPath };
  });

  ipcMain.handle('resources:archive', async (event, payload) => {
    assertTrustedSender(event);
    const resources = Array.isArray(payload?.resources) ? payload.resources.slice(0, 100) : [];
    if (!resources.length) throw new Error('请至少选择一个资源');
    const articleTitle = sanitizeFilename(payload?.articleTitle || '公众号文章');
    const chosen = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '导出资源包', defaultPath: path.join(app.getPath('downloads'), `${articleTitle}-资源.zip`),
      buttonLabel: '导出 ZIP', filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    const finalPath = chosen.filePath.toLowerCase().endsWith('.zip') ? chosen.filePath : `${chosen.filePath}.zip`;
    const tempPath = `${finalPath}.part-${process.pid}`;
    const output = createWriteStream(tempPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(output);
    const completed = new Promise((resolve, reject) => {
      output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
    });
    try {
      for (let index = 0; index < resources.length; index += 1) {
        const item = resources[index];
        event.sender.send('download:progress', { current: index + 1, total: resources.length, name: item.name });
        try {
          const response = await fetchResource(item);
          archive.append(Readable.fromWeb(response.body).pipe(new ByteLimit(MAX_RESOURCE_BYTES)), {
            name: sanitizeFilename(item.name || `resource-${index + 1}`)
          });
        } catch { /* Skip an unavailable item and continue the archive. */ }
      }
      await archive.finalize();
      await completed;
      await replaceWithTemp(tempPath, finalPath);
    } catch (error) {
      archive.abort(); await rm(tempPath, { force: true }); throw error;
    }
    return { canceled: false, path: finalPath };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerProtocols(); registerIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await createMainWindow();
  app.on('activate', async () => { if (BrowserWindow.getAllWindows().length === 0) await createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

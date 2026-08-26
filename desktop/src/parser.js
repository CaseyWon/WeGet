import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const TYPE_LABELS = {
  head: '头图', card: '卡片图', image: '正文图片',
  video: '视频', audio: '音频', file: '其他文件'
};

const FILE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z',
  'txt', 'csv', 'epub', 'apk'
]);

function decodeScriptString(value = '') {
  try { return JSON.parse(`"${value.replace(/"/g, '\\"')}"`); }
  catch {
    return value
      .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, '/');
  }
}

function scriptValue(html, name) {
  const match = html.match(new RegExp(`(?:var\\s+)?${name}\\s*=\\s*["']((?:\\\\.|[^"'])*)["']`, 'i'));
  return match ? decodeScriptString(match[1]) : '';
}

function cleanText(value = '') { return value.replace(/\s+/g, ' ').trim(); }

export function normalizeUrl(raw, baseUrl) {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw.trim().replace(/&amp;/g, '&').replace(/^['"]|['"]$/g, '');
  if (!cleaned || /^(data|javascript|blob):/i.test(cleaned)) return '';
  try {
    const url = new URL(cleaned.startsWith('//') ? `https:${cleaned}` : cleaned, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

export function extensionFromUrl(resourceUrl, fallback = '') {
  try {
    const url = new URL(resourceUrl);
    const format = url.searchParams.get('wx_fmt') || url.searchParams.get('format');
    if (format && /^[a-z0-9]{2,5}$/i.test(format)) return format.toLowerCase().replace('jpeg', 'jpg');
    const match = url.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
  } catch { /* Use fallback. */ }
  return fallback;
}

function resourceName(type, index, url) {
  const fallback = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : type === 'file' ? 'bin' : 'jpg';
  return `${TYPE_LABELS[type]}-${String(index).padStart(2, '0')}.${extensionFromUrl(url, fallback)}`;
}

function looksLikeCard($, element) {
  return Boolean($(element).closest([
    'mp-miniprogram', 'mp-common-product', 'mp-shop-card', 'mp-weapp',
    '.weapp_card', '.js_product_container', '.goods_card', '.js_miniprogram_container',
    '[data-miniprogram-appid]', '[data-card-type]'
  ].join(',')).length);
}

function resourceId(url, type) {
  return crypto.createHash('sha256').update(`${type}:${url}`).digest('hex').slice(0, 16);
}

export function parseWeChatArticle(html, sourceUrl) {
  const $ = cheerio.load(html);
  const title = cleanText(
    $('meta[property="og:title"]').attr('content') || $('#activity-name').text() ||
    scriptValue(html, 'msg_title') || $('title').text()
  ).replace(/\s*[-—_]\s*微信公众平台\s*$/i, '');
  const author = cleanText(
    $('meta[name="author"]').attr('content') || $('#js_name').text() ||
    scriptValue(html, 'nickname') || scriptValue(html, 'author')
  );
  const description = cleanText(
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') || scriptValue(html, 'msg_desc')
  );
  const timestamp = Number(scriptValue(html, 'ct'));
  const publishedAt = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString() : '';

  const resources = [];
  const seen = new Map();
  const counters = { head: 0, card: 0, image: 0, video: 0, audio: 0, file: 0 };

  const add = (rawUrl, type, extra = {}) => {
    const url = normalizeUrl(rawUrl, sourceUrl);
    if (!url) return;
    const key = url.replace(/([?&])tp=webp(&|$)/, '$1').replace(/[?&]$/, '');
    const existing = seen.get(key);
    if (existing) {
      if (type === 'head' || (type === 'card' && existing.type === 'image')) {
        existing.type = type;
        existing.typeLabel = TYPE_LABELS[type];
      }
      return;
    }
    counters[type] += 1;
    const item = {
      id: resourceId(url, type), type, typeLabel: TYPE_LABELS[type], url,
      name: resourceName(type, counters[type], url),
      alt: cleanText(extra.alt || ''), width: Number(extra.width) || null,
      height: Number(extra.height) || null, source: extra.source || ''
    };
    seen.set(key, item);
    resources.push(item);
  };

  [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    scriptValue(html, 'msg_cdn_url'), scriptValue(html, 'cdn_url')
  ].forEach(url => add(url, 'head', { source: '文章头图' }));

  $('[data-miniprogram-imageurl], [data-card-image], [data-cover], [data-coverurl]').each((_, element) => {
    for (const attr of ['data-miniprogram-imageurl', 'data-card-image', 'data-cover', 'data-coverurl']) {
      add($(element).attr(attr), 'card', { source: '小程序 / 商品卡片' });
    }
  });

  $('img').each((_, element) => {
    const node = $(element);
    const rawUrl = node.attr('data-src') || node.attr('data-original') || node.attr('data-backsrc') || node.attr('src');
    let type = looksLikeCard($, element) ? 'card' : 'image';
    if (/cover|cdn_url|rich_media_thumb/i.test(`${node.attr('class') || ''} ${node.attr('id') || ''}`)) type = 'head';
    add(rawUrl, type, {
      alt: node.attr('alt') || node.attr('data-title'),
      width: node.attr('data-w') || node.attr('width'), height: node.attr('data-h') || node.attr('height'),
      source: type === 'card' ? '卡片内图片' : '文章正文'
    });
  });

  $('[style*="url("]').each((_, element) => {
    const style = $(element).attr('style') || '';
    for (const match of style.matchAll(/url\(["']?([^)'" ]+)/gi)) {
      add(match[1], looksLikeCard($, element) ? 'card' : 'image', { source: '背景图片' });
    }
  });

  $('video, iframe, mpvideo, mp-video').each((_, element) => {
    const node = $(element);
    add(node.attr('poster') || node.attr('data-poster'), 'image', { source: '视频封面' });
    for (const attr of ['data-src', 'src', 'data-url', 'data-video-url', 'data-videourl']) {
      add(node.attr(attr), 'video', { source: '文章视频' });
    }
  });

  $('audio, source, mpvoice, mp-audio, qqmusic').each((_, element) => {
    const node = $(element);
    for (const attr of ['data-src', 'src', 'data-url', 'data-audio-url']) {
      const value = node.attr(attr);
      const ext = extensionFromUrl(value || '');
      add(value, /^(mp4|mov|m3u8|webm)$/i.test(ext) ? 'video' : 'audio', { source: '文章音频' });
    }
  });

  $('a[href]').each((_, element) => {
    const href = normalizeUrl($(element).attr('href'), sourceUrl);
    if (FILE_EXTENSIONS.has(extensionFromUrl(href))) add(href, 'file', { alt: $(element).text(), source: '附件链接' });
  });

  const counts = Object.fromEntries(Object.keys(counters).map(type => [type, resources.filter(item => item.type === type).length]));
  return {
    article: { title: title || '未命名文章', author: author || '微信公众号', description, publishedAt, sourceUrl },
    resources, counts, total: resources.length
  };
}

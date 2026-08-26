import crypto from 'node:crypto';

export function isArticleHost(hostname = '') {
  const host = hostname.toLowerCase();
  return host === 'mp.weixin.qq.com' || host === 'weixin.qq.com';
}

export function isResourceHost(hostname = '') {
  const host = hostname.toLowerCase();
  return [
    'qpic.cn', 'qlogo.cn', 'weixin.qq.com', 'qq.com', 'gtimg.com',
    'wxqcloud.qq.com', 'wxaurl.cn'
  ].some(domain => host === domain || host.endsWith(`.${domain}`));
}

export function safeUrl(raw, hostValidator) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw new Error('链接格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 链接');
  if (!hostValidator(url.hostname)) throw new Error('该链接不在允许的微信域名范围内');
  return url;
}

export function createSigner(secret = crypto.randomBytes(32).toString('hex')) {
  const sign = url => crypto.createHmac('sha256', secret).update(url).digest('base64url');
  const verify = (url, token = '') => {
    const expected = sign(url);
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  };
  return { sign, verify };
}

export function sanitizeFilename(value = 'resource') {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 100) || 'resource';
}

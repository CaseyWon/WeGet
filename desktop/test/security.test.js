import test from 'node:test';
import assert from 'node:assert/strict';
import { createSigner, isArticleHost, isResourceHost, safeUrl, sanitizeFilename } from '../src/security.js';

test('restricts article and resource domains', () => {
  assert.equal(isArticleHost('mp.weixin.qq.com'), true);
  assert.equal(isArticleHost('evil-mp.weixin.qq.com.example.com'), false);
  assert.equal(isResourceHost('mmbiz.qpic.cn'), true);
  assert.equal(isResourceHost('qpic.cn.example.com'), false);
  assert.throws(() => safeUrl('https://example.com', isArticleHost));
});

test('signs resources and sanitizes Windows filenames', () => {
  const { sign, verify } = createSigner('test-secret');
  const url = 'https://mmbiz.qpic.cn/a/1';
  assert.equal(verify(url, sign(url)), true);
  assert.equal(verify(`${url}x`, sign(url)), false);
  assert.equal(sanitizeFilename('a:b<c>.jpg'), 'a-b-c-.jpg');
});

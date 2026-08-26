import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeChatArticle } from '../src/parser.js';

const sourceUrl = 'https://mp.weixin.qq.com/s/example';
const fixture = `<!doctype html><html><head>
  <meta property="og:title" content="桌面版测试文章">
  <meta property="og:image" content="https://mmbiz.qpic.cn/cover/0?wx_fmt=jpeg">
  <meta name="author" content="测试公众号">
</head><body><div id="js_content">
  <img data-src="https://mmbiz.qpic.cn/body/1?wx_fmt=png">
  <mp-miniprogram data-miniprogram-imageurl="https://mmbiz.qpic.cn/card/2?wx_fmt=jpg"></mp-miniprogram>
  <video data-src="https://mpvideo.qpic.cn/video/3.mp4" poster="https://mmbiz.qpic.cn/poster/3?wx_fmt=webp"></video>
</div></body></html>`;

test('classifies desktop article resources', () => {
  const result = parseWeChatArticle(fixture, sourceUrl);
  assert.equal(result.article.title, '桌面版测试文章');
  assert.equal(result.counts.head, 1);
  assert.equal(result.counts.card, 1);
  assert.equal(result.counts.image, 2);
  assert.equal(result.counts.video, 1);
  assert.equal(result.total, 5);
});

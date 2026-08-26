import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, parseWeChatArticle } from '../lib/parser.js';

const sourceUrl = 'https://mp.weixin.qq.com/s/example';
const fixture = `<!doctype html><html><head>
  <meta property="og:title" content="一篇测试文章">
  <meta property="og:image" content="https://mmbiz.qpic.cn/cover/0?wx_fmt=jpeg">
  <meta name="author" content="测试公众号">
</head><body>
  <div id="js_content">
    <img data-src="https://mmbiz.qpic.cn/body/1?wx_fmt=png" data-w="1080" alt="正文图">
    <mp-miniprogram data-miniprogram-imageurl="https://mmbiz.qpic.cn/card/2?wx_fmt=jpg">
      <img data-src="https://mmbiz.qpic.cn/card/2?wx_fmt=jpg">
    </mp-miniprogram>
    <video data-src="https://mpvideo.qpic.cn/video/3.mp4" poster="https://mmbiz.qpic.cn/poster/3?wx_fmt=webp"></video>
    <a href="https://res.wx.qq.com/files/guide.pdf">资料</a>
  </div>
</body></html>`;

test('parses article metadata and classifies resources', () => {
  const result = parseWeChatArticle(fixture, sourceUrl);
  assert.equal(result.article.title, '一篇测试文章');
  assert.equal(result.article.author, '测试公众号');
  assert.equal(result.counts.head, 1);
  assert.equal(result.counts.card, 1);
  assert.equal(result.counts.image, 2);
  assert.equal(result.counts.video, 1);
  assert.equal(result.counts.file, 1);
  assert.equal(result.total, 6);
});

test('normalizes protocol-relative URLs and rejects unsafe schemes', () => {
  assert.equal(normalizeUrl('//mmbiz.qpic.cn/a/1', sourceUrl), 'https://mmbiz.qpic.cn/a/1');
  assert.equal(normalizeUrl('javascript:alert(1)', sourceUrl), '');
  assert.equal(normalizeUrl('data:image/png;base64,abc', sourceUrl), '');
});

const api = window.wegetDesktop;
const form = document.querySelector('#parse-form');
const urlInput = document.querySelector('#article-url');
const pasteButton = document.querySelector('#paste-button');
const parseButton = document.querySelector('#parse-button');
const commandSection = document.querySelector('#command-section');
const loading = document.querySelector('#loading');
const loadingCopy = document.querySelector('#loading-copy');
const results = document.querySelector('#results');
const emptyState = document.querySelector('#empty-state');
const filters = document.querySelector('#filters');
const grid = document.querySelector('#resource-grid');
const emptyFilter = document.querySelector('#empty-filter');
const selectAllButton = document.querySelector('#select-all');
const exportButton = document.querySelector('#export-button');
const selectedCount = document.querySelector('#selected-count');
const progress = document.querySelector('#progress');
const progressBar = document.querySelector('#progress-bar');
const progressCopy = document.querySelector('#progress-copy');
const toast = document.querySelector('#toast');

const typeOrder = ['all', 'head', 'card', 'image', 'video', 'audio', 'file'];
const typeNames = { all:'全部', head:'头图', card:'卡片图', image:'正文图', video:'视频', audio:'音频', file:'其他' };
let data = null;
let activeType = 'all';
let selected = new Set();
let loadingTimer;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 2800);
}

function friendlyError(error, fallback) {
  return String(error?.message || fallback)
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
    .replace(/^Error:\s*/, '');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function setStep(number) {
  document.querySelectorAll('.step').forEach(step => step.classList.toggle('active', Number(step.dataset.step) === number));
}

function setLoading(on) {
  loading.hidden = !on;
  parseButton.disabled = on;
  parseButton.querySelector('span').textContent = on ? '正在解析' : '开始解析';
  clearInterval(loadingTimer);
  if (on) {
    setStep(1);
    const messages = ['正在连接微信服务器…','正在识别文章结构…','正在整理媒体资源…','马上就好，正在生成预览…'];
    let index = 0; loadingCopy.textContent = messages[index];
    loadingTimer = setInterval(() => { index = Math.min(index + 1, messages.length - 1); loadingCopy.textContent = messages[index]; }, 1800);
  }
}

function formatDate(iso) {
  return iso ? new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'long', day:'numeric' }).format(new Date(iso)) : '';
}

function renderFilters() {
  filters.innerHTML = typeOrder.map(type => {
    const count = type === 'all' ? data.total : (data.counts[type] || 0);
    if (type !== 'all' && count === 0) return '';
    return `<button class="filter${activeType === type ? ' active' : ''}" type="button" data-type="${type}" role="tab">${typeNames[type]} <span>${count}</span></button>`;
  }).join('');
}

function fileKind(resource) {
  try { const url = new URL(resource.url); return (url.searchParams.get('wx_fmt') || url.pathname.split('.').pop() || resource.type).slice(0,5).toUpperCase(); }
  catch { return resource.type.toUpperCase(); }
}

function cardHtml(resource) {
  const visual = resource.previewUrl
    ? `<img src="${escapeHtml(resource.previewUrl)}" alt="${escapeHtml(resource.alt || resource.name)}" loading="lazy">`
    : `<span class="file-glyph">${escapeHtml(fileKind(resource))}</span>`;
  return `<article class="resource-card${selected.has(resource.id) ? ' selected' : ''}" data-id="${resource.id}">
    <div class="resource-preview"><input class="resource-check" type="checkbox" aria-label="选择 ${escapeHtml(resource.name)}" ${selected.has(resource.id) ? 'checked' : ''}><span class="type-tag">${escapeHtml(resource.typeLabel)}</span>${visual}</div>
    <div class="resource-info"><div><p class="resource-name" title="${escapeHtml(resource.name)}">${escapeHtml(resource.name)}</p><p class="resource-origin">${escapeHtml(resource.source || 'WECHAT ASSET')}</p></div><button class="save-button" type="button" title="另存为" aria-label="保存 ${escapeHtml(resource.name)}"><svg viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 20h14"/></svg></button></div>
  </article>`;
}

function updateSelection() {
  selectedCount.textContent = selected.size;
  exportButton.disabled = selected.size === 0;
  const visible = data?.resources.filter(item => activeType === 'all' || item.type === activeType) || [];
  selectAllButton.textContent = visible.length && visible.every(item => selected.has(item.id)) ? '取消全选' : '全选';
}

function renderGrid() {
  const visible = data.resources.filter(item => activeType === 'all' || item.type === activeType);
  grid.innerHTML = visible.map(cardHtml).join('');
  grid.hidden = visible.length === 0; emptyFilter.hidden = visible.length !== 0; updateSelection();
}

function renderResult(payload) {
  data = payload; activeType = 'all'; selected = new Set(); setStep(2);
  document.querySelector('#article-title').textContent = data.article.title;
  document.querySelector('#article-meta').textContent = [data.article.author, formatDate(data.article.publishedAt)].filter(Boolean).join(' · ');
  document.querySelector('#total-count').textContent = data.total;
  document.querySelector('#rail-total').textContent = data.total;
  const cover = data.resources.find(item => item.type === 'head') || data.resources.find(item => ['image','card'].includes(item.type));
  document.querySelector('#summary-cover').innerHTML = cover ? `<img src="${escapeHtml(cover.previewUrl)}" alt="文章封面">` : '<span>WG</span>';
  renderFilters(); renderGrid(); results.hidden = false; emptyState.hidden = true;
  commandSection.classList.add('has-results');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const url = urlInput.value.trim(); if (!url) return;
  setLoading(true); results.hidden = true; emptyState.hidden = true;
  try {
    const payload = await api.parseArticle(url);
    renderResult(payload); showToast(`解析完成，共找到 ${payload.total} 项资源`);
  } catch (error) {
    emptyState.hidden = false; showToast(friendlyError(error, '解析失败，请稍后重试'), true);
  } finally { setLoading(false); }
});

pasteButton.addEventListener('click', async () => {
  try { urlInput.value = await api.readClipboard(); urlInput.focus(); }
  catch { showToast('无法读取剪贴板，请手动粘贴', true); }
});

document.querySelector('#source-button').addEventListener('click', () => data && api.openSource(data.article.sourceUrl));

filters.addEventListener('click', event => {
  const button = event.target.closest('[data-type]'); if (!button) return;
  activeType = button.dataset.type; renderFilters(); renderGrid();
});

grid.addEventListener('change', event => {
  const checkbox = event.target.closest('.resource-check'); if (!checkbox) return;
  const card = checkbox.closest('.resource-card');
  checkbox.checked ? selected.add(card.dataset.id) : selected.delete(card.dataset.id);
  card.classList.toggle('selected', checkbox.checked); updateSelection();
});

grid.addEventListener('click', async event => {
  const saveButton = event.target.closest('.save-button');
  const card = event.target.closest('.resource-card'); if (!card) return;
  const resource = data.resources.find(item => item.id === card.dataset.id);
  if (saveButton) {
    saveButton.disabled = true;
    try { const result = await api.saveResource(resource); if (!result.canceled) showToast(`已保存到 ${result.path}`); }
    catch (error) { showToast(friendlyError(error, '保存失败'), true); }
    finally { saveButton.disabled = false; }
    return;
  }
  if (event.target.closest('input')) return;
  const checkbox = card.querySelector('.resource-check'); checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event('change', { bubbles:true }));
});

selectAllButton.addEventListener('click', () => {
  const visible = data.resources.filter(item => activeType === 'all' || item.type === activeType);
  const allSelected = visible.every(item => selected.has(item.id));
  visible.forEach(item => allSelected ? selected.delete(item.id) : selected.add(item.id)); renderGrid();
});

api.onDownloadProgress(payload => {
  progress.hidden = false; progressBar.style.width = `${Math.round(payload.current / payload.total * 100)}%`;
  progressCopy.textContent = `${payload.current} / ${payload.total} · ${payload.name}`;
});

exportButton.addEventListener('click', async () => {
  const resources = data.resources.filter(item => selected.has(item.id));
  exportButton.disabled = true; setStep(3);
  try {
    const result = await api.saveArchive({ articleTitle:data.article.title, resources });
    if (!result.canceled) showToast(`资源包已导出到 ${result.path}`);
  } catch (error) { showToast(friendlyError(error, '导出失败'), true); }
  finally { progress.hidden = true; exportButton.disabled = false; setStep(2); }
});

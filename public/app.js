// 这是网站的“前端行为”：负责按钮、页面切换、发送问题和显示结果。
// $ 找一个页面元素，$$ 找一组页面元素，作用类似“按名字找到按钮”。
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// 网站虽然只有一个网址，但内部有四个画面，按需要轮流显示。
const views = {
  single: $('#singleView'),
  compare: $('#compareView'),
  loading: $('#loadingView'),
  result: $('#resultView'),
};

let currentMode = 'single';
let loadingTimer;

function showView(name) {
  Object.entries(views).forEach(([key, element]) => element.classList.toggle('hidden', key !== name));
  $('.topbar').classList.toggle('hidden', name === 'loading' || name === 'result');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 在“现象分析”和“观点对比”两个功能之间切换。
function switchMode() {
  currentMode = currentMode === 'single' ? 'compare' : 'single';
  $('[data-switch]').textContent = currentMode === 'single' ? '观点对比' : '现象分析';
  showView(currentMode);
}

function goHome() {
  clearInterval(loadingTimer);
  currentMode = 'single';
  $('[data-switch]').textContent = '观点对比';
  showView('single');
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

// 等待 AI 回复时，循环展示几句进度提示。
function beginLoading() {
  const messages = ['先看清表面的争议…', '再找到背后的原因…', '继续往下看真正的问题…', '正在整理最终判断…'];
  let index = 0;
  $('#loadingText').textContent = messages[0];
  showView('loading');
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    index = (index + 1) % messages.length;
    $('#loadingText').textContent = messages[index];
  }, 1800);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

// 把 DeepSeek 返回的六层分析，做成六张逐层堆叠的卡片。
function renderSingle(data) {
  $('#resultTag').textContent = data.verdict || '分析结果';
  $('#resultTitle').textContent = data.topic || '这件事可以这样看';
  $('#resultSummary').textContent = data.summary || '';
  const layers = Array.isArray(data.layers) ? data.layers.slice(0, 6) : [];
  $('#resultContent').innerHTML = layers.map((layer, index) => `
    <article class="layer-card">
      <span class="layer-number">第 ${index + 1} 层</span>
      <h2>${escapeHtml(layer.title)}</h2>
      <p>${escapeHtml(layer.content)}</p>
    </article>
  `).join('');
}

// 把两个观点的共同点和冲突点做成四张卡片。
function renderCompare(data) {
  $('#resultTag').textContent = data.relationship || '对比结果';
  $('#resultTitle').textContent = '这两个观点的关系';
  $('#resultSummary').textContent = data.conclusion || '';
  const cards = [
    ['观点 A 真正在意什么', data.meaningA],
    ['观点 B 真正在意什么', data.meaningB],
    ['它们相同的地方', data.commonGround],
    ['它们冲突的地方', data.conflict],
  ];
  $('#resultContent').innerHTML = cards.map(([title, content], index) => `
    <article class="compare-card">
      <small>0${index + 1}</small>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(content)}</p>
    </article>
  `).join('');
}

// 把用户输入发送给后端 /api/analyze，再把后端结果显示出来。
async function analyze(payload, mode) {
  beginLoading();
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '分析失败，请稍后重试');
    clearInterval(loadingTimer);
    mode === 'single' ? renderSingle(data) : renderCompare(data);
    showView('result');
  } catch (error) {
    clearInterval(loadingTimer);
    showView(mode);
    showToast(error.message || '网络出现问题，请稍后重试');
  }
}

// 下面这些代码把页面上的按钮和表单，连接到上面的功能。
$('[data-switch]').addEventListener('click', switchMode);
$$('[data-home]').forEach((button) => button.addEventListener('click', goHome));
$$('[data-example]').forEach((button) => button.addEventListener('click', () => {
  $('#question').value = button.dataset.example;
  $('#question').focus();
}));

$('#singleForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const content = $('#question').value.trim();
  if (!content) return showToast('请先输入一个问题');
  analyze({ mode: 'single', content }, 'single');
});

$('#compareForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const viewpointA = $('#viewpointA').value.trim();
  const viewpointB = $('#viewpointB').value.trim();
  if (!viewpointA || !viewpointB) return showToast('请把两个观点都填写完整');
  analyze({ mode: 'compare', viewpointA, viewpointB }, 'compare');
});

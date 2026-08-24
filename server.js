import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// 这里是网站的“后端”。它负责两件事：
// 1. 把 public 文件夹里的手机页面发给浏览器；2. 安全地调用 DeepSeek。
const root = fileURLToPath(new URL('./public/', import.meta.url));
// CloudBase 会自动提供 PORT；在自己电脑运行时则使用 3000。
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const json = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
};

// 读取浏览器发来的问题，并限制大小，避免一次传入过多内容。
const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 24_000) throw new Error('内容过长');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

// 这两段提示词决定 DeepSeek 应该怎样分析，以及必须返回什么格式。
const singlePrompt = (content) => `请分析下面这个生活现象或观点：\n${content}\n\n请用普通人能直接理解的中文，客观、中立、简短地输出 JSON。不要使用学术术语，不要假装拥有不存在的事实来源。格式必须是：\n{\n  "topic": "用一句话重述问题",\n  "layers": [\n    {"title":"这件事是什么","content":"一句到两句"},\n    {"title":"大家为什么争论","content":"概括最主要的两种看法"},\n    {"title":"为什么会出现","content":"概括三到四个主要原因"},\n    {"title":"真正的问题是什么","content":"指出表面问题下面最核心的矛盾"},\n    {"title":"应该怎么判断","content":"用自愿、公平、伤害、承受能力等朴素标准判断"},\n    {"title":"最终结论","content":"给出有条件的清晰结论"}\n  ],\n  "verdict": "只能填写：合理、有条件合理、不合理、暂时无法判断",\n  "summary": "一句最重要的话",\n  "note": "一句说明不确定性，没有则留空"\n}`;

const comparePrompt = (a, b) => `请比较下面两个观点：\n观点A：${a}\n观点B：${b}\n\n请用普通人能直接理解的中文，客观、中立、简短地输出 JSON。格式必须是：\n{\n  "meaningA":"观点A真正想表达什么",\n  "meaningB":"观点B真正想表达什么",\n  "commonGround":"两者相同的地方，没有则明确写没有明显共同点",\n  "conflict":"两者真正冲突的地方，没有则明确写没有明显冲突",\n  "relationship":"只能填写：基本一致、部分一致、表面冲突、根本冲突",\n  "conclusion":"一句清晰的最终说明"\n}`;

async function callDeepSeek(payload) {
  // 密钥只存在 CloudBase 的服务端环境变量里，不会发送给网页访问者。
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('服务尚未配置 API 密钥');

  const prompt = payload.mode === 'compare'
    ? comparePrompt(payload.viewpointA, payload.viewpointB)
    : singlePrompt(payload.content);

  // 后端代表网页向 DeepSeek 发出请求。
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是一个面向普通人的现象解析助手。保持中立，区分事实与价值选择，只输出有效 JSON。',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.35,
      max_tokens: 1600,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('DeepSeek API error:', response.status, errorText.slice(0, 300));
    throw new Error(response.status === 401 ? 'API 密钥无效' : 'AI 服务暂时不可用');
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 没有返回有效内容');
  return JSON.parse(content);
}

async function handleAnalyze(req, res) {
  try {
    const body = await readBody(req);
    // 在调用 AI 前先检查用户有没有填写内容、内容是否过长。
    if (body.mode === 'compare') {
      if (!body.viewpointA?.trim() || !body.viewpointB?.trim()) {
        return json(res, 400, { error: '请填写两个观点' });
      }
      if (body.viewpointA.length > 600 || body.viewpointB.length > 600) {
        return json(res, 400, { error: '观点内容过长' });
      }
    } else {
      if (!body.content?.trim()) return json(res, 400, { error: '请输入想分析的问题' });
      if (body.content.length > 1000) return json(res, 400, { error: '问题内容过长' });
    }
    const result = await callDeepSeek(body);
    return json(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '分析失败，请稍后重试';
    return json(res, message === '内容过长' ? 413 : 500, { error: message });
  }
}

async function serveStatic(req, res) {
  // 例如访问 /styles.css 时，就读取 public/styles.css 并返回给浏览器。
  const url = new URL(req.url, 'http://localhost');
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root)) return json(res, 403, { error: '禁止访问' });

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(file);
  } catch {
    json(res, 404, { error: '页面不存在' });
  }
}

// 网站的总入口：根据访问地址，把请求交给不同功能处理。
createServer(async (req, res) => {
  // CloudBase 用这个地址确认服务是否正常运行。
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true });
  }
  // 手机页面点击“开始分析”后，会把问题发送到这里。
  if (req.method === 'POST' && req.url === '/api/analyze') return handleAnalyze(req, res);
  // 普通页面、样式和脚本文件从 public 文件夹读取。
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  return json(res, 405, { error: '请求方式不支持' });
}).listen(port, '0.0.0.0', () => {
  console.log(`往里看已启动：http://localhost:${port}`);
});

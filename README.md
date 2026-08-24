# 往里看

一个面向手机端的现象解析网站。用户输入生活现象，系统通过 DeepSeek API 生成六层递进分析；也可以比较两个观点的底层关系。

## 运行

需要 Node.js 20 或更高版本。

1. 在运行环境中设置 `DEEPSEEK_API_KEY`。
2. 执行 `npm start` 或 `node server.js`。
3. 打开 `http://localhost:3000`。

项目不包含任何第三方依赖，API 密钥只在服务端使用。

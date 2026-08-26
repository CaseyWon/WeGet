# WeGet Desktop

微信公众号文章资源提取桌面应用。解析、预览和文件保存均在本机完成，不启动额外 HTTP 服务。

## 开发运行

```bash
npm install
npm start
```

## 测试

```bash
npm test
```

## 构建 Windows 安装包

```bash
npm run build:win
```

安装包输出到 `release/`。

## 安全设计

- 渲染进程关闭 Node.js 集成，并启用上下文隔离与沙箱。
- preload 仅暴露解析、保存、打开原文和读取剪贴板等有限方法。
- IPC 请求验证来源页面；导航、弹窗和权限请求默认拒绝。
- 仅允许微信文章域名和腾讯相关资源 CDN。
- 单个资源限制 50 MB，单次最多导出 100 项。

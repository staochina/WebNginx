# WebNginx

面向 Chrome 的 Nginx 风格请求规则：对带 `server_name` 的 `proxy_pass` 做透明反向代理，其余规则（`rewrite` / 拦截 / 仅改 header）走 declarativeNetRequest。

## 工作模式

| 配置 | 行为 |
| --- | --- |
| `server_name` + `proxy_pass` | 通过 `chrome.proxy` PAC → 本地 Native Messaging host 做 MITM 透明代理，地址栏保持原域名 |
| `rewrite` / `return 403\|444` / 无 `server_name` 的 `proxy_pass` | 走现有 declarativeNetRequest（URL 改写 / 拦截等） |

HTTPS 透明代理需要信任本地 CA（生成在 `~/.webnginx/`）。

## 安装（macOS）

1. 在 `chrome://extensions` 加载未打包扩展（`src/`，或 `make buildc` 打出的 zip）。
2. 复制扩展 ID。
3. 安装本地 native host（目录 [`webnginx-native/`](webnginx-native/)）：

```bash
make install-host EXT_ID=你的扩展ID
```

4. 启用一条 `proxy_pass` 规则并 Save 一次（host 会生成 CA），然后：

```bash
make trust-ca
```

5. **完全退出 Chrome（Cmd+Q）再打开**，使 TLS 信任生效。
6. Options 页 → **Proxy status**：代理在听时应显示徽章 **ON**（`127.0.0.1:17890` 已监听）。

### 新环境清单

- 安装 Node.js（`node` / `npm` 在 PATH 中）
- 安装 / 加载 Chrome 扩展，并记下扩展 ID（加载路径变化后 ID 可能改变）
- 拷贝 `webnginx-native/`（可不带 `node_modules`）
- 执行 `make install-host EXT_ID=...`；若需 HTTPS，再执行 `make trust-ca`
- 完全退出并重新打开 Chrome

### 安全说明

- 本地 CA 可对 PAC 命中的域名做 HTTPS MITM；只有匹配的 `server_name` 会进入 PAC。
- 代理仅监听 `127.0.0.1`。
- CA 私钥保存在 `~/.webnginx/`，不会打进扩展 zip。

### 停止代理

- 日常：点扩展图标关掉总开关（会清空 Chrome PAC，并断开 native host）。
- 仅停某条规则：Options 里取消 Active 或删除 server，再 Save and Sync。

## 开发

```bash
make test
make build
```

本地代理源码在 [`webnginx-native/`](webnginx-native/)（Node.js + `node-forge`）。

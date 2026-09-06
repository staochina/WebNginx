# WebNginx

面向 Chrome 的 Nginx 风格请求规则。每个 `server` 必须填写 `server_name`。

- **透明反向代理（MITM）**：`server_name` + 纯 `proxy_pass`（无 `rewrite` / `return`）→ PAC + 本地 Native Host，地址栏保持原域名
- **declarativeNetRequest（DNR）**：`rewrite` / `return 403|444` / 纯改 Header，或同 Location 把 `proxy_pass` 与 `rewrite`/`return` 写在一起 → 浏览器侧改写 / 拦截 / 改头

源代码：[https://github.com/staochina/WebNginx](https://github.com/staochina/WebNginx)

设置页提供四栏摘要（**工作原理** / **操作与填写说明** / **本地 Host 与 CA（从零安装）** / **卸载与移除信任证书**）；完整说明以本文为准。工具栏 **Debug** 开启后仅在控制台打印 `[WebNginx]` 日志（不落盘；关闭或 Service Worker 重启后恢复为关）。

## 工作模式

| 配置 | 行为 |
| --- | --- |
| `server_name` + `proxy_pass`（无 `rewrite` / `return`） | PAC → Native Host MITM；`proxy_set_header` / `add_header` 由 host 转发时处理 |
| 同上但 Location 含 `rewrite` / `return` | **退回 DNR**，不再进 MITM；退回的 `proxy_pass` 会对目标响应自动补 CORS，并跳过 OPTIONS 重定向 |
| `rewrite` / `return 403\|444` / 纯改 Header | DNR（均须带 `server_name`） |

空 `server_name` 或顶层裸 `location` 会被拒绝。

本地代理默认 `127.0.0.1:17890`（Options → Proxy status，**Save and Sync** 后生效）。HTTPS MITM 需信任 `~/.webnginx/` 下的本地 CA。

## 配置要点（设置页）

- 编辑 / Import 只改编辑区；必须 **Save and Sync** 才写入并应用到 DNR / PAC / host。未保存关闭会丢失。
- `server_name` 必填，可空格写多个域名。
- Location：前缀 `/`、`/api`，或正则 `~` / `~*`。指令每行以 `;` 结尾：`proxy_pass`、`rewrite`、`proxy_set_header`、`add_header`、`return 403|444`。
- 同 server 内**更靠下**的 Location 优先（可拖 ⋮⋮）；Inactive（导出为 `inactive on;`）不参与。
- 弹窗 **Enable Active Rules** 是全局总开关（立刻启用/清空已保存规则）；与单条 Active 是两层控制。
- Export / Import 使用 nginx 风格 `.conf`；Import 整体替换（不合并），须再 Save 才生效。
- **Listen port** 非法（非 1–65535）会导致保存失败。

### 示例

```nginx
server {
    server_name www.abcd.com;
    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

上例走 MITM。若同 Location 再写 `rewrite` / `return`，整条退回 DNR。

## 从零安装（macOS，新手顺序）

纯 DNR（`rewrite` / `return` / 改 Header）**只需第 1 步加载扩展**。只有要用透明 `proxy_pass`（MITM）时，才需要后面的 Native Host 与 CA。

### 准备

- 本机已装 **Node.js**（终端能跑 `node -v`、`npm -v`）
- 已拿到本仓库（含 `src/` 与 `webnginx-native/`）
- 在 **webnginx-native 安装目录**（`webnginx-native/`）打开终端（下面命令都在这里执行；也可用仓库根目录的 `make install-host` / `make trust-ca`）

### 顺序（按步做，不要跳）

| 步 | 你做什么 | 命令 / 打开哪里 | 这一步会生成什么 |
| --- | --- | --- | --- |
| **1** | 加载扩展 | Chrome 打开 `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选仓库里的 **`src/`**（或先 `make buildc`，再加载解压后的 zip；zip 根目录须含 `manifest.json`） | 扩展出现在列表里，并有一串 **ID** |
| **2** | 记下扩展 ID | 仍在 `chrome://extensions`，复制该扩展的 ID | （无文件） |
| **3** | 安装 Native Host | 在 webnginx-native 安装目录执行下行命令（把 ID 换成你的） | Chrome Native Messaging 配置；缺依赖时会 `npm install`。**不**生成 CA、**不**写入钥匙串 |
| **4** | 刷新扩展 | 回到 `chrome://extensions`，点 WebNginx 的 **重新加载** | 扩展重新读到刚装的 host 绑定 |
| **5** | 打开设置并写一条 MITM 规则 | 扩展 → **Options**；或弹窗进设置。加一个 `server`：填 `server_name`，Location 勾 Active，Directives 写纯 `proxy_pass …;`（不要同条再写 `rewrite`/`return`） | （仅编辑区，尚未生效） |
| **6** | 打开总开关并保存 | 工具栏弹窗打开 **Enable Active Rules**；设置页点 **Save and Sync** | 启动 host、监听端口；**首次**会在 `~/.webnginx/` 生成 `ca.crt` / `ca.key`（叶证书只在内存，不进系统） |
| **7** | 信任本地 CA（HTTPS 必做） | 确认 `~/.webnginx/ca.crt` 已存在后，在 webnginx-native 安装目录执行下行命令；按提示输入本机密码 | 把 CA 写入**登录钥匙串**为信任根（`install-host` 不会做这一步） |
| **8** | 完全退出再开 Chrome | **Cmd+Q** 退出 Chrome（不要只关窗口），再重新打开 | 让 Chrome 重新读取钥匙串信任 |
| **9** | 确认成功 | Options → **透明代理状态 · Proxy status**：徽章 **ON**；访问你配置的 `server_name` 域名做验证 | — |

**第 3 步命令：**

```bash
make install-host EXT_ID=你的扩展ID
```

**第 7 步命令：**

```bash
make trust-ca
```

设置页「本地 Host 与 CA」栏有同一套摘要；细节与排错见下文。

### 换机 / 换 ID / 重装时

- 扩展 ID 变了（换加载路径、重装未打包扩展等）→ 必须再跑一遍 **第 3 步** `make install-host EXT_ID=…`，然后 **第 4 步** 重新加载扩展
- 删过 `~/.webnginx/`、换过 CA、或新机首次 HTTPS → 先 Save 一次生成 CA，再 **第 7–8 步** `make trust-ca` + Cmd+Q
- **只改 Listen port** → Save and Sync 即可，不必重生或重信任 CA

### 停止代理

- 日常：关掉弹窗总开关（清空 PAC，并断开 native host）
- 仅停某条：Options 取消 Active 或删除 server，再 Save and Sync

## 卸载干净（macOS）

按顺序做，可只卸扩展、或连 Host / CA / 信任一并清掉。

| 步 | 操作 | 说明 |
| --- | --- | --- |
| **1** | 关掉弹窗 **Enable Active Rules** | 清空 PAC、断开 native host，避免残留系统代理设置 |
| **2** | `chrome://extensions` → 移除 **WebNginx** | 卸掉扩展本身 |
| **3** | 删除 Native Messaging 注册 | 见下方命令；不删则换 ID 后仍可能指向旧绑定 |
| **4** | 删除运行时 CA 目录 | `~/.webnginx/`（含 `ca.crt` / `ca.key`） |
| **5** | 从登录钥匙串移除受信任 CA | 见下一节；**只删文件不会撤销信任** |
| **6** | （可选）删除本仓库 / `webnginx-native/` | 源码与 `node_modules`；不删也不影响系统，只是占磁盘 |
| **7** | **Cmd+Q** 完全退出 Chrome 再打开 | 让代理与证书信任状态刷新 |

**第 3–4 步命令示例：**

```bash
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webnginx.proxy.json"
rm -rf "$HOME/.webnginx"
```

设置页「卸载与移除信任证书」栏有同一套摘要。

## 移除受信任证书（macOS）

`make trust-ca` 会把 **WebNginx Local CA** 写入**登录钥匙串**。卸载时务必手动移除，否则系统仍信任该 CA。

### 图形界面（推荐）

1. 打开 **钥匙串访问**（Spotlight 搜「钥匙串访问」/ Keychain Access）
2. 左侧选 **登录**（login），类别选 **证书**
3. 找到 **WebNginx Local CA**（组织名多为 WebNginx）
4. 右键 → **删除**；按提示输入本机密码
5. 若仍看到信任条目：选中该证书 → 右键「显示简介」→ **信任** → 将「使用此证书时」改回默认后删掉，或确认证书已不在列表中
6. **Cmd+Q** 退出 Chrome 再打开

### 命令行

若 `~/.webnginx/ca.crt` 还在：

```bash
security remove-trusted-cert -d "$HOME/.webnginx/ca.crt"
```

若证书文件已删、只清钥匙串中的同名项：

```bash
security delete-certificate -c "WebNginx Local CA" "$HOME/Library/Keychains/login.keychain-db"
```

完成后同样 **Cmd+Q** 重开 Chrome。若提示找不到证书，说明钥匙串里已无该项（或名称不同，请用「钥匙串访问」核对）。

## 本地 Host 与 CA

仅 MITM（透明 `proxy_pass`）需要 Host；纯 DNR 可不装。从零安装顺序见上文 [从零安装（macOS，新手顺序）](#从零安装macos新手顺序)。

### `webnginx-native/`（源码与安装）

本地 MITM 反向代理（Node.js + `node-forge`），经 Native Messaging 与扩展通信。

| 文件 | 作用 |
| --- | --- |
| `host.js` | Native Messaging 入口，接收路由并驱动代理 |
| `host-wrapper.sh` | 安装时生成；用固定 `node` 路径启动 `host.js` |
| `proxyServer.js` | 监听 `127.0.0.1:<port>`，HTTPS MITM 与上游转发 |
| `ca.js` | 本地 CA；按域名签发叶证书 |
| `routes.js` | 按 Host / 路径匹配路由 |
| `install-macos.sh` | 写 Chrome Native Messaging manifest（绑定扩展 ID） |
| `trust-ca-macos.sh` | 将 `~/.webnginx/ca.crt` 加入登录钥匙串 |
| `package.json` | 依赖；缺 `node_modules` 时安装脚本会 `npm install` |

- Host 名：`com.webnginx.proxy`
- Manifest：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webnginx.proxy.json`
- 换扩展 ID / 换机 / 重装后需重新 `make install-host EXT_ID=...`

### `~/.webnginx/`（运行时 CA）

本机私有目录，首次 MITM 时由 host 创建；**不**打进扩展 zip，勿提交 git。

| 文件 | 作用 |
| --- | --- |
| `ca.crt` | 本地 CA（`make trust-ca` 信任对象） |
| `ca.key` | CA 私钥（保持私有） |

叶证书一般在 host 进程内按域名缓存，不落盘。

### 端口与证书

- 默认 `127.0.0.1:17890`；改端口后 **Save and Sync**。
- **只改端口不必**重生或重信任 CA。
- 需再 `make trust-ca`（并 Cmd+Q 重开 Chrome）：首次 HTTPS MITM、删除/更换 `~/.webnginx/`、换机、主动换 CA。

### 安全

- 仅 PAC 命中的 `server_name` 会进本地代理；代理只绑 `127.0.0.1`
- CA 私钥只在本机 `~/.webnginx/`

### 常见问题

- 徽章 OFF：`EXT_ID` 是否与当前扩展一致；总开关是否开；是否已 Save 透明代理规则
- HTTPS 警告：是否已 `make trust-ca`，是否 **Cmd+Q** 完全退出后重开
- 端口占用：换 Listen port 后 Save；无需动 `~/.webnginx/`

## 开发

```bash
make test
make build
```

- `make buildc` → `target/webnginx-chrome.zip`（`src/` 下文件，无多余 `src/` 前缀）
- 扩展侧共享文本解析：[`src/nginxText.js`](src/nginxText.js)；规则引擎 [`src/nginxParser.js`](src/nginxParser.js)；设置页模型 [`src/configModel.js`](src/configModel.js)

## 需求文档

- [需求沟通纪要](docs/requirements-comms/设置页与透明代理体验-需求沟通纪要.md)
- [正式需求](docs/requirements-docs/设置页与透明代理体验-需求.md)

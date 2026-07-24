# reflex

一个用 Rust 编写的高性能通用代理内核，配置与规则集格式对齐 sing-box / Clash(mihomo)，
支持主流代理协议、DNS 分流（含 FakeIP）、透明代理（TProxy/TUN）与 Clash 兼容管理 API。

> 本仓库为发布用途整理的稳定分支（`stable`），版本号、构建方式详见下方「构建」与
> Release 页面。

## 特性

- **多协议出站**：VLESS、VMess、Trojan、Shadowsocks、Hysteria2、TUIC、AnyTLS、NaïveProxy、
  WireGuard、SSH、ShadowQuic（JLS 伪装）、Tailscale，以及 Direct / Block / Selector 等基础出站。
- **多种传输层**：TLS（含 REALITY、uTLS 指纹伪装、ECH）、WebSocket、gRPC、XHTTP。
- **灵活入站**：Mixed（HTTP+SOCKS）、纯 HTTP、纯 SOCKS5、TUN（系统/gVisor 协议栈）、
  TProxy、Redirect、DNS。
- **DNS 分流**：UDP/TCP/DoH/DoT/DoQ/DoH3、本地 hosts、系统 resolver、FakeIP、按内置
  rcode 拦截，规则可按 ruleset / 查询类型分流到不同上游。
- **规则集**：兼容 sing-box JSON rule-set、Clash/mihomo `payload:` YAML 规则、
  AdGuardHome/AdBlock 风格 `.txt` 过滤列表，内置编译器可转换为体积更小的二进制 `.rrs` 格式，
  查询效率更高。
- **Clash 兼容 API**：可接入现有 Clash/mihomo 面板做代理选择、延迟测速、流量统计、日志查看。
- **策略路由**：进程名/PID、源 IP、域名（含正则）、协议嗅探（TLS/HTTP/QUIC/SSH/BitTorrent）
  等多维度规则，出口可按 `auto_detect_interface` 自动跟随系统路由或显式指定网卡/fwmark。
- **面向资源受限设备**：`portable-atomic` 补齐 mips/mipsel 等缺失 64 位原子指令的平台，
  官方 Release 提供 x86 / ARMv7 / MIPS(BE) / MIPSLE / Android(ARMv7) 等多架构预编译产物。

## 安装

### 下载预编译二进制

前往 [Releases](../../releases) 页面下载对应平台的产物（Linux 为裸二进制，Windows 为
`.exe`），赋予可执行权限后运行即可：

```bash
chmod +x reflex-linux-x86
./reflex-linux-x86 -d /etc/reflex
```

每个产物都附带 `.sha256` 校验文件，建议下载后校验完整性：

```bash
sha256sum -c reflex-linux-x86.sha256
```

### 从源码构建

需要 Rust stable 工具链（部分平台如 MIPS 需要 nightly + `build-std`，详见 CI 工作流）。

```bash
git clone <repo-url>
cd reflex
cargo build --release --no-default-features --features outbound-net
```

编译完成后二进制位于 `target/release/reflex`。默认启用 `jemalloc` feature；如需协议层
支持（TLS/VMess/VLESS/Trojan/Shadowsocks/WireGuard/SSH/gRPC/DoH3 等），需开启
`outbound-net` feature（见上方命令）。

## 快速开始

1. 复制示例配置并按需修改（推荐从 YAML 开始，注释更完整）：

   ```bash
   cp config.example.yaml config.yaml
   ```

2. 校验配置是否合法：

   ```bash
   reflex check config.yaml
   ```

3. 启动代理：

   ```bash
   reflex -c config.yaml
   # 或指定工作目录，自动查找 config.json / config.yaml：
   reflex -d /etc/reflex
   ```

## 命令行用法

```text
PROXY MODE:
  reflex [run] [OPTIONS]
    -d, -D, --dir <DIR>       工作目录；配置文件与相对路径均以此为基准解析
                                 自动依次查找 config.json → config.yaml →
                                 目录下唯一的 .json / .yaml / .yml 文件
    -c, -C, --config <PATH>   配置文件路径（相对于 -d，如果提供）[默认: config.json]
                                 支持 .json（允许 JSONC 注释）/ .yaml / .yml
    -l, --log <LEVEL>         日志级别（trace/debug/info/warn/error/off）
    -v, --version
    -h, --help

RULESET COMMANDS:
  reflex ruleset <input.json|input.txt> -o <output.rrs> [-t adguard]
        将 sing-box JSON 规则集 / reflex 文本规则集 / AdGuardHome-AdBlock 风格
        .txt 过滤列表编译为二进制 .rrs（.txt 输入会自动探测 AdGuardHome 格式，
        也可用 -t adguard 强制指定）

  reflex check <config.json|config.yaml>
        仅校验配置文件，不启动代理

  reflex convert <input.json|input.yaml> -o <output.yaml|output.json>
        在 JSON 与 YAML 之间转换配置（按扩展名推断格式；JSON 转 YAML 会丢失注释）

  reflex inspect <input.rrs>
        查看已编译 .rrs 二进制规则集的统计信息

  reflex test-rule <input.rrs> <domain|ip|port>
        测试某个查询是否命中已编译的规则集

EXAMPLES:
  reflex -d /etc/reflex
  reflex -d /etc/reflex -c myconf.yaml
  reflex ruleset geosite-cn.json -o rules/geosite-cn.rrs
  reflex ruleset adguard-base.txt -o rules/adguard-base.rrs -t adguard
  reflex convert config.json -o config.yaml
  reflex inspect rules/geosite-cn.rrs
  reflex test-rule rules/geosite-cn.rrs www.baidu.com
```

完整参数说明可运行 `reflex --help` 查看。

## 配置

配置格式与 sing-box 基本对齐，支持 JSON（含 `//` `#` 注释）与 YAML 两种写法，仓库内提供
两份等价的完整示例：

- [`config.example.json`](./config.example.json)
- [`config.example.yaml`](./config.example.yaml)

顶层字段包括：

| 字段 | 说明 |
| --- | --- |
| `dns` | DNS 服务器与分流规则（支持 UDP/TCP/DoH/DoT/DoQ/DoH3/hosts/FakeIP 等） |
| `inbounds` | 入站列表：`mixed` / `http` / `socks` / `tun` / `tproxy` / `redir` / `dns` |
| `route` | 路由规则、出口网络（自动检测接口 / fwmark）、协议嗅探 |
| `outbounds` | 出站/代理组列表 |
| `experimental` | Clash 兼容 API、缓存文件等实验特性 |
| `log` | 日志级别与输出配置 |

## 项目结构

```text
src/
├── app/         # 应用装配层：调度器、出站管理、Clash API、流量统计、协议嗅探
├── config/      # 配置结构体定义与解析（dns / inbound / outbound / route / ...）
├── dns/         # DNS 解析器、各类上游传输、缓存、FakeIP
├── inbound/     # 入站实现：mixed / http / socks / tun / tproxy / redir / dns
├── outbound/    # 出站协议实现，含 tls/ 与 transport/ 子模块
├── provider/    # 远程订阅 / 规则集拉取与健康检查
├── router/      # 路由匹配引擎
├── ruleset/     # 规则集解析、编译（.rrs 格式）与匹配（trie）
├── clash_mode.rs
└── main.rs      # CLI 入口，含内置规则集编译器子命令
tests/           # 集成测试：config / dns / router
```

## 支持的平台（预编译产物）

| 产物 | 架构 | 说明 |
| --- | --- | --- |
| `reflex-linux-x86` | Linux x86 (32-bit) | musl 静态链接 |
| `reflex-linux-armv7` | Linux ARMv7 | musleabihf 静态链接 |
| `reflex-windows-x86.exe` | Windows x86 (32-bit) | MSVC |
| `reflex-android-armv7` | Android ARMv7 | 通过 NDK 构建 |
| `reflex-linux-mipsle` | Linux MIPS 小端 (soft-float) | musl 静态链接 |
| `reflex-linux-mips` | Linux MIPS 大端 | musl 静态链接 |

## 构建 / CI

仓库使用 GitHub Actions 交叉编译上述全部平台并自动创建 GitHub Release，产物附带
`.sha256` 校验文件，同时打包 `stable` 分支源码为 `source_code.zip` 一并上传。

## 许可证

请参阅仓库根目录的 LICENSE 文件（如未包含，请联系维护者确认授权条款）。

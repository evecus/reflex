//! DNS 解析器：接收查询，按规则分流到不同上游，内置 LRU 缓存。
//!
//! 优化（参照 sing-box）：
//! - transport 隔离：不同上游的缓存条目互不干扰
//! - Optimistic 模式：过期缓存在窗口期内仍返回，后台异步刷新
//! - 持久化：store_dns=true 时写入 redb，重启后自动恢复
//! - **并发请求去重**（新增）：同一 (transport, qname, qtype) 的并发查询只发出一次上游请求，
//!   参照 sing-box dns/client.go 的 cacheLock 机制，消除 DNS 请求风暴。
//! - **负 TTL / SOA 缓存**（新增）：NXDOMAIN/NOERROR-empty 应答按 SOA minimum 缓存，
//!   避免对不存在域名反复查询上游（对应 sing-box extractNegativeTTL）。

pub mod cache;
pub mod upstream;

use std::{collections::HashMap, sync::Arc, time::Duration};

use bytes::Bytes;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use crate::ruleset::{MatchTarget, RuleSet};

use crate::{
    clash_mode::ClashMode,
    config::dns::{DnsConfig, DnsQueryType, DnsRuleConfig, ResolveStrategy},
    experimental::{CacheFile, CacheFileReader},
    inbound::dns::DnsQuery,
    outbound::Outbound,
};

use cache::{CacheResult, DnsCache, InflightResult};
use upstream::DnsUpstream;

// ── FakeIP 反向查找结果 ───────────────────────────────────────────────────────

/// 参照 sing-box route.go routeConnection 的三路分支：
/// - IP 不在任何 fakeip 段   → NotFakeIp（正常路由）
/// - IP 在段内且有 store 记录 → Found(domain)（恢复域名后路由）
/// - IP 在段内但 store 无记录 → Missing（应断连，建议开启 store_fakeip）
#[derive(Debug)]
pub enum FakeIpLookup {
    NotFakeIp,
    Found(String),
    Missing,
}

// ── DNS 解析器 ────────────────────────────────────────────────────────────────

pub struct DnsResolver {
    rules: Vec<CompiledDnsRule>,
    default: Arc<DnsUpstream>,
    cache: Option<Arc<DnsCache>>,
    /// 全部已注册的 DNS 上游，key 为 server tag，供 resolve_server 指定时使用
    upstreams: HashMap<String, Arc<DnsUpstream>>,
    /// 生效的解析策略（由 global.ipv6 + dns.strategy 合并决定）
    pub strategy: ResolveStrategy,
    /// `dns.proxy_domain_resolver` 指定的 server tag，用于解析代理出站节点的服务器域名。
    /// 构造时已校验该 tag 存在于 upstreams 中。
    proxy_domain_resolver: Option<String>,
    /// Clash API 当前模式的共享只读引用，供 DNS 规则的 `clash_mode` 条件匹配使用。
    clash_mode: Arc<ClashMode>,
}

impl DnsResolver {
    pub fn from_config(config: &DnsConfig) -> anyhow::Result<Self> {
        Self::from_config_full(
            config,
            &HashMap::new(),
            None,
            None,
            None,
            0,
            Arc::new(ClashMode::new("rule")),
        )
    }

    pub fn from_config_with_rulesets(
        config: &DnsConfig,
        rulesets: &HashMap<String, Arc<RuleSet>>,
    ) -> anyhow::Result<Self> {
        Self::from_config_full(
            config,
            rulesets,
            None,
            None,
            None,
            0,
            Arc::new(ClashMode::new("rule")),
        )
    }

    pub fn from_config_with_rulesets_and_outbounds(
        config: &DnsConfig,
        rulesets: &HashMap<String, Arc<RuleSet>>,
        outbounds: Option<&HashMap<String, Arc<dyn Outbound>>>,
    ) -> anyhow::Result<Self> {
        Self::from_config_full(
            config,
            rulesets,
            outbounds,
            None,
            None,
            0,
            Arc::new(ClashMode::new("rule")),
        )
    }

    /// 最完整构造：支持 CacheFile 注入（fakeip 持久化 + DNS 缓存持久化）。
    ///
    /// `clash_mode`：Clash API 当前模式的共享状态，用于 DNS 规则的 `clash_mode`
    /// 条件。生产环境（`app/mod.rs`）应传入与 `Router`/`ClashApi` 共享的同一个
    /// `Arc<ClashMode>` 实例；其余 wrapper 构造函数（测试/简化场景）各自创建
    /// 一个独立实例，互不影响。
    pub fn from_config_full(
        config: &DnsConfig,
        rulesets: &HashMap<String, Arc<RuleSet>>,
        outbounds: Option<&HashMap<String, Arc<dyn Outbound>>>,
        cache_writer: Option<Arc<CacheFile>>,
        cache_reader: Option<Arc<CacheFileReader>>,
        routing_mark: u32,
        clash_mode: Arc<ClashMode>,
    ) -> anyhow::Result<Self> {
        // 验证 optimistic 和 disable_cache 不能同时开
        if config.optimistic_timeout > 0 && config.disable_cache {
            anyhow::bail!("`optimistic_timeout` cannot be used with `disable_cache: true`");
        }

        // ── 拓扑排序 & 构建 upstreams ────────────────────────────────────────
        let order = toposort_servers(&config.servers)?;
        let mut upstreams: HashMap<String, Arc<DnsUpstream>> = HashMap::new();

        for idx in order {
            let srv = &config.servers[idx];

            let detour = match (&srv.detour, outbounds) {
                (Some(tag), Some(obs)) => match obs.get(tag) {
                    Some(ob) => {
                        tracing::info!(dns_server=%srv.tag, detour=%tag, "dns server detour resolved");
                        Some(ob.clone())
                    }
                    None => anyhow::bail!(
                        "dns server '{}' references unknown detour '{}'",
                        srv.tag,
                        tag
                    ),
                },
                (Some(tag), None) => {
                    tracing::warn!(dns_server=%srv.tag, detour=%tag,
                        "detour configured but no outbounds map; queries will be sent directly");
                    None
                }
                (None, _) => None,
            };

            let domain_resolver = match &srv.domain_resolver {
                Some(tag) => match upstreams.get(tag) {
                    Some(up) => {
                        tracing::info!(dns_server=%srv.tag, domain_resolver=%tag, "resolved");
                        Some(up.clone())
                    }
                    None => anyhow::bail!(
                        "dns server '{}' references unknown domain_resolver '{}'",
                        srv.tag,
                        tag
                    ),
                },
                None => None,
            };

            // fakeip upstream 才注入 cache_file/reader，其他忽略
            let (cf, cr) = if srv.protocol() == crate::config::dns::DnsProtocol::FakeIp {
                (cache_writer.clone(), cache_reader.clone())
            } else {
                (None, None)
            };

            upstreams.insert(
                srv.tag.clone(),
                Arc::new(
                    DnsUpstream::from_config_full_with_reader(
                        srv,
                        detour,
                        cf,
                        cr,
                        domain_resolver,
                    )?
                    .with_mark(routing_mark)
                    .with_strategy(config.strategy),
                ),
            );
        }

        // ── 编译规则 ──────────────────────────────────────────────────────────
        let rules = config
            .rules
            .iter()
            .map(|r| CompiledDnsRule::compile(r, &upstreams, rulesets))
            .collect::<anyhow::Result<Vec<_>>>()?;

        let default = upstreams
            .get(&config.r#final)
            .ok_or_else(|| anyhow::anyhow!("dns.final '{}' not found", config.r#final))?
            .clone();

        // `proxy_domain_resolver` 必须引用一个已存在的 server tag
        if let Some(tag) = &config.proxy_domain_resolver {
            if !upstreams.contains_key(tag) {
                anyhow::bail!("dns.proxy_domain_resolver '{}' not found in dns.servers", tag);
            }
        }

        // ── 构建缓存 ──────────────────────────────────────────────────────────
        let cache = if config.disable_cache {
            None
        } else {
            let ttl_cap = if config.cache_ttl_max > 0 {
                config.cache_ttl_max
            } else {
                3600
            };
            let optimistic_ttl = if config.optimistic_timeout > 0 {
                Some(Duration::from_secs(config.optimistic_timeout))
            } else {
                None
            };
            // 只有 store_dns=true 时才有持久化句柄
            let (pr, pw) = if cache_reader.as_ref().is_some_and(|r| r.store_dns) {
                (cache_reader, cache_writer)
            } else {
                (None, None)
            };

            Some(Arc::new(DnsCache::with_options(
                config.cache_capacity,
                ttl_cap,
                optimistic_ttl,
                pr,
                pw,
            )))
        };

        Ok(Self {
            rules,
            default,
            cache,
            upstreams,
            strategy: config.strategy,
            proxy_domain_resolver: config.proxy_domain_resolver.clone(),
            clash_mode,
        })
    }

    /// 查询 FakeIP 地址是否落在已知的 FakeIP 段内，若是则反向查找对应的域名。
    /// 参照 sing-box route.go routeConnection：
    ///   - IP 不在任何 fakeip 段 → `FakeIpLookup::NotFakeIp`
    ///   - IP 在段内且有记录    → `FakeIpLookup::Found(domain)`
    ///   - IP 在段内但无记录   → `FakeIpLookup::Missing`（应断连，建议开启 cache_file）
    pub fn lookup_fakeip(&self, addr: std::net::IpAddr) -> FakeIpLookup {
        for upstream in self.upstreams.values() {
            if let upstream::UpstreamKind::FakeIp { store } = &upstream.kind {
                if store.contains(addr) {
                    return match store.lookup(addr) {
                        Some(domain) => FakeIpLookup::Found(domain),
                        None => FakeIpLookup::Missing,
                    };
                }
            }
        }
        FakeIpLookup::NotFakeIp
    }

    /// 同步更新所有 fakeip upstream 的 strategy。
    /// 在 global.ipv6=false 时调用，强制覆盖为 Ipv4Only。
    pub fn set_fakeip_strategy(&self, s: crate::config::dns::ResolveStrategy) {
        for upstream in self.upstreams.values() {
            if let upstream::UpstreamKind::FakeIp { store } = &upstream.kind {
                store.set_strategy(s);
            }
        }
        // default upstream 也可能是 fakeip
        if let upstream::UpstreamKind::FakeIp { store } = &self.default.kind {
            store.set_strategy(s);
        }
    }

    pub async fn resolve_domain(&self, host: &str) -> anyhow::Result<std::net::IpAddr> {
        // 按域名匹配规则，选出正确的上游；跳过 fakeip；无匹配则用 default
        // inbound_tag 传空串：dispatcher 内部调用不属于任何入站
        let upstream = self
            .rules
            .iter()
            .find(|r| {
                r.matches("", host, 1 /* A */, &self.clash_mode.get())
                    && !matches!(r.upstream.kind, upstream::UpstreamKind::FakeIp { .. })
            })
            .map(|r| r.upstream.clone())
            .unwrap_or_else(|| {
                // default 本身也可能是 fakeip，此时回退到第一个非 fakeip upstream
                if matches!(self.default.kind, upstream::UpstreamKind::FakeIp { .. }) {
                    self.upstreams
                        .values()
                        .find(|u| !matches!(u.kind, upstream::UpstreamKind::FakeIp { .. }))
                        .cloned()
                        .unwrap_or_else(|| self.default.clone())
                } else {
                    self.default.clone()
                }
            });
        self.resolve_domain_with_strategy(host, self.strategy, &upstream)
            .await
    }

    /// 解析域名的**全部**候选地址（A + AAAA），按 `strategy` 排序，供 Happy
    /// Eyeballs 多候选拨号使用（对齐 sing-box `network_strategy` 的候选地址
    /// 来源）。upstream 选择逻辑和 `resolve_domain` 完全一致，区别只是不止取
    /// 第一个 IP。
    pub async fn resolve_domain_all(&self, host: &str) -> anyhow::Result<Vec<std::net::IpAddr>> {
        let upstream = self
            .rules
            .iter()
            .find(|r| {
                r.matches("", host, 1 /* A */, &self.clash_mode.get())
                    && !matches!(r.upstream.kind, upstream::UpstreamKind::FakeIp { .. })
            })
            .map(|r| r.upstream.clone())
            .unwrap_or_else(|| {
                if matches!(self.default.kind, upstream::UpstreamKind::FakeIp { .. }) {
                    self.upstreams
                        .values()
                        .find(|u| !matches!(u.kind, upstream::UpstreamKind::FakeIp { .. }))
                        .cloned()
                        .unwrap_or_else(|| self.default.clone())
                } else {
                    self.default.clone()
                }
            });
        self.resolve_domain_all_with_strategy(host, self.strategy, &upstream)
            .await
    }

    /// 内部：用指定上游和指定策略解析域名的全部候选地址，按策略排序。
    /// 与 `resolve_domain_with_strategy` 结构保持一致，便于对照维护。
    async fn resolve_domain_all_with_strategy(
        &self,
        host: &str,
        strategy: ResolveStrategy,
        upstream: &Arc<DnsUpstream>,
    ) -> anyhow::Result<Vec<std::net::IpAddr>> {
        use std::net::IpAddr;
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(vec![ip]);
        }

        match strategy {
            ResolveStrategy::Ipv4Only => {
                let query_a = build_query(host, 1u16);
                let resp = upstream.query(query_a.into()).await;
                let v4 = resp
                    .ok()
                    .as_deref()
                    .map(|r| extract_all_ips(r, 1))
                    .unwrap_or_default();
                if v4.is_empty() {
                    anyhow::bail!("dns resolve failed for '{host}': no A answer");
                }
                Ok(v4)
            }
            ResolveStrategy::Ipv6Only => {
                let query_aaaa = build_query(host, 28u16);
                let resp = upstream.query(query_aaaa.into()).await;
                let v6 = resp
                    .ok()
                    .as_deref()
                    .map(|r| extract_all_ips(r, 28))
                    .unwrap_or_default();
                if v6.is_empty() {
                    anyhow::bail!("dns resolve failed for '{host}': no AAAA answer");
                }
                Ok(v6)
            }
            ResolveStrategy::PreferIpv4 | ResolveStrategy::PreferIpv6 => {
                let query_a = build_query(host, 1u16);
                let query_aaaa = build_query(host, 28u16);
                let (resp_a, resp_aaaa) = tokio::join!(
                    upstream.query(query_a.into()),
                    upstream.query(query_aaaa.into()),
                );
                let v4 = resp_a
                    .ok()
                    .as_deref()
                    .map(|r| extract_all_ips(r, 1))
                    .unwrap_or_default();
                let v6 = resp_aaaa
                    .ok()
                    .as_deref()
                    .map(|r| extract_all_ips(r, 28))
                    .unwrap_or_default();
                let mut out = Vec::with_capacity(v4.len() + v6.len());
                if matches!(strategy, ResolveStrategy::PreferIpv6) {
                    out.extend(v6);
                    out.extend(v4);
                } else {
                    out.extend(v4);
                    out.extend(v6);
                }
                if out.is_empty() {
                    anyhow::bail!("dns resolve failed for '{host}': no answer");
                }
                Ok(out)
            }
        }
    }
    /// 若配置了 `dns.proxy_domain_resolver`，走该 server tag（沿用全局 `strategy`）；
    /// 否则回退到 `resolve_domain`（按规则 + dns.final 默认上游解析，行为与之前一致）。
    pub async fn resolve_proxy_domain(&self, host: &str) -> anyhow::Result<std::net::IpAddr> {
        match &self.proxy_domain_resolver {
            Some(tag) => self.resolve_domain_via(host, tag).await,
            None => self.resolve_domain(host).await,
        }
    }

    /// 使用指定 server tag 的 DNS 上游解析域名。
    /// 若 tag 不存在则回退到默认上游并记录 warn 日志。
    pub async fn resolve_domain_via(
        &self,
        host: &str,
        server_tag: &str,
    ) -> anyhow::Result<std::net::IpAddr> {
        let upstream = match self.upstreams.get(server_tag) {
            Some(up) => up.clone(),
            None => {
                tracing::warn!(
                    server_tag,
                    host,
                    "resolve_domain_via: server tag not found, falling back to default"
                );
                self.default.clone()
            }
        };
        self.resolve_domain_with_strategy(host, self.strategy, &upstream)
            .await
    }

    /// 内部：用指定上游和指定策略解析域名。
    async fn resolve_domain_with_strategy(
        &self,
        host: &str,
        strategy: ResolveStrategy,
        upstream: &Arc<DnsUpstream>,
    ) -> anyhow::Result<std::net::IpAddr> {
        use std::net::IpAddr;
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(ip);
        }

        match strategy {
            ResolveStrategy::Ipv4Only => {
                // 只查 A 记录
                let query_a = build_query(host, 1u16);
                let resp = upstream.query(query_a.into()).await;
                resp.ok()
                    .as_deref()
                    .and_then(|r| extract_first_ip(r, 1))
                    .ok_or_else(|| anyhow::anyhow!("dns resolve failed for '{host}': no A answer"))
            }
            ResolveStrategy::Ipv6Only => {
                // 只查 AAAA 记录
                let query_aaaa = build_query(host, 28u16);
                let resp = upstream.query(query_aaaa.into()).await;
                resp.ok()
                    .as_deref()
                    .and_then(|r| extract_first_ip(r, 28))
                    .ok_or_else(|| {
                        anyhow::anyhow!("dns resolve failed for '{host}': no AAAA answer")
                    })
            }
            ResolveStrategy::PreferIpv4 | ResolveStrategy::PreferIpv6 => {
                // 并发查 A + AAAA，按优先级选择（tokio::join! 避免串行等待两次 RTT）
                let query_a = build_query(host, 1u16);
                let query_aaaa = build_query(host, 28u16);
                let (resp_a, resp_aaaa) = tokio::join!(
                    upstream.query(query_a.into()),
                    upstream.query(query_aaaa.into()),
                );
                let ipv4 = resp_a.ok().as_deref().and_then(|r| extract_first_ip(r, 1));
                let ipv6 = resp_aaaa
                    .ok()
                    .as_deref()
                    .and_then(|r| extract_first_ip(r, 28));
                match (strategy, ipv4, ipv6) {
                    (ResolveStrategy::PreferIpv6, _, Some(v6)) => Ok(v6),
                    (ResolveStrategy::PreferIpv6, Some(v4), None) => Ok(v4),
                    (_, Some(v4), _) => Ok(v4),
                    (_, None, Some(v6)) => Ok(v6),
                    _ => anyhow::bail!("dns resolve failed for '{host}': no answer"),
                }
            }
        }
    }

    /// 启动 DNS 处理循环
    /// 返回内存诊断数据，供定期日志使用：
    /// - `cache_len`    : DNS LRU 缓存条目数
    /// - `inflight_len` : inflight 去重表条目数（正常应趋近于 0）
    /// - `fakeip_sizes` : FakeIpStore 三张表的条目数 (addr_to_domain, domain_to_v4, domain_to_v6)
    pub fn diag(&self) -> (usize, usize, Option<(usize, usize, usize)>) {
        let cache_len = self.cache.as_ref().map_or(0, |c| c.len());
        let inflight_len = self.cache.as_ref().map_or(0, |c| c.inflight_len());
        let fakeip_sizes = self.upstreams.values().find_map(|u| {
            if let crate::dns::upstream::UpstreamKind::FakeIp { store, .. } = &u.kind {
                Some(store.diag_sizes())
            } else {
                None
            }
        });
        (cache_len, inflight_len, fakeip_sizes)
    }

    /// 清空内存 DNS 缓存（对应 Clash API `POST /cache/dns/flush`）。
    pub fn clear_cache(&self) {
        if let Some(ref cache) = self.cache {
            cache.clear();
            tracing::info!("dns cache flushed");
        }
    }

    /// 对指定域名和类型进行一次 DNS 查询，返回原始 DNS 报文。
    /// 用于 Clash API `GET /dns/query?name=...&type=A`。
    pub async fn resolve_raw(&self, name: &str, qtype: u16) -> anyhow::Result<Vec<u8>> {
        let query = build_query_bytes(name, qtype);
        // 用 default upstream 直接查询（不走路由规则，不影响 fake-ip 分配）
        let resp = self
            .default
            .query(bytes::Bytes::from(query))
            .await
            .map_err(|e| anyhow::anyhow!("dns query failed: {e}"))?;
        Ok(resp.to_vec())
    }

    pub async fn run(self: Arc<Self>, mut rx: mpsc::Receiver<DnsQuery>) {
        while let Some(query) = rx.recv().await {
            let resolver = self.clone();
            tokio::spawn(async move {
                let resp = match resolver
                    .handle(query.message.clone(), &query.inbound_tag)
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        warn!(err=%e, from=%query.from, "dns resolve error");
                        make_servfail(&query.message)
                    }
                };
                let _ = query.reply_tx.send(resp);
            });
        }
    }

    async fn handle(&self, msg: Bytes, inbound_tag: &str) -> anyhow::Result<Bytes> {
        let qname = extract_qname(&msg).unwrap_or_default();
        let qtype = extract_qtype(&msg).unwrap_or(1);
        debug!(qname=%qname, qtype=qtype, inbound=%inbound_tag, "dns query");

        // ── 规则匹配，选择上游 ────────────────────────────────────────────────
        let current_mode = self.clash_mode.get();
        let (upstream, disable_cache) = self
            .rules
            .iter()
            .find(|r| r.matches(inbound_tag, &qname, qtype, &current_mode))
            .map(|r| (r.upstream.clone(), r.disable_cache))
            .unwrap_or_else(|| (self.default.clone(), false));

        let transport_tag = upstream.tag.clone();

        // ── 查缓存 ────────────────────────────────────────────────────────────
        if let (Some(cache), false) = (&self.cache, disable_cache) {
            match cache.get(&transport_tag, &qname, qtype) {
                CacheResult::Hit(cached) => {
                    debug!(qname=%qname, transport=%transport_tag, "dns cache hit");
                    return Ok(patch_id(cached, &msg));
                }
                CacheResult::Stale(cached) => {
                    debug!(qname=%qname, transport=%transport_tag, "dns cache stale, refreshing in background");
                    // 后台异步刷新
                    let cache2 = cache.clone();
                    let upstream2 = upstream.clone();
                    let msg2 = msg.clone();
                    let qname2 = qname.clone();
                    let transport_tag2 = transport_tag.clone();
                    tokio::spawn(async move {
                        if let Ok(resp) = upstream2.query(msg2).await {
                            if is_cacheable_or_negative(&resp) {
                                let ttl = extract_min_ttl_or_negative(&resp).unwrap_or(60);
                                cache2.set(&transport_tag2, &qname2, qtype, resp, ttl);
                            }
                        }
                    });
                    return Ok(patch_id(cached, &msg));
                }
                CacheResult::Miss => {}
            }

            // ── 并发请求去重（参照 sing-box cacheLock）────────────────────────
            // 同一 (transport, qname, qtype) 若已有 leader 在查询，本请求作为 waiter 等待广播结果。
            match cache.try_lead_inflight(&transport_tag, &qname, qtype) {
                InflightResult::Waiter(mut rx) => {
                    debug!(qname=%qname, transport=%transport_tag, "dns inflight dedup: waiting for leader");
                    match rx.recv().await {
                        Ok(cached) => return Ok(patch_id(cached, &msg)),
                        Err(_) => {
                            // leader 查询失败，waiter 自行发起查询（不再经过去重）
                            debug!(qname=%qname, "dns inflight leader failed, waiter retrying directly");
                            let resp = upstream.query(msg).await?;
                            if is_cacheable_or_negative(&resp) {
                                let ttl = extract_min_ttl_or_negative(&resp).unwrap_or(60);
                                cache.set(&transport_tag, &qname, qtype, resp.clone(), ttl);
                            }
                            return Ok(resp);
                        }
                    }
                }
                InflightResult::Leader => {
                    // 本请求作为 leader，查询上游，然后广播结果
                    let resp = upstream.query(msg.clone()).await;
                    match resp {
                        Ok(resp) => {
                            if is_cacheable_or_negative(&resp) {
                                let ttl = extract_min_ttl_or_negative(&resp).unwrap_or(60);
                                cache.set(&transport_tag, &qname, qtype, resp.clone(), ttl);
                            }
                            cache.complete_inflight(&transport_tag, &qname, qtype, Some(&resp));
                            return Ok(resp);
                        }
                        Err(e) => {
                            cache.complete_inflight(&transport_tag, &qname, qtype, None);
                            return Err(e);
                        }
                    }
                }
            }
        }

        // ── 无缓存路径：直接查询上游 ──────────────────────────────────────────
        let resp = upstream.query(msg).await?;
        Ok(resp)
    }
}

// ── 编译后的 DNS 规则 ─────────────────────────────────────────────────────────

struct CompiledDnsRule {
    inbound_tags: Vec<String>,
    query_types: Vec<u16>,
    inline_rs: Option<Arc<RuleSet>>,
    file_rulesets: Vec<Arc<RuleSet>>,
    upstream: Arc<DnsUpstream>,
    disable_cache: bool,
    /// 仅当 Clash API 当前模式等于该值时才命中（对应 `clash_mode`），
    /// 大小写不敏感比较；None 表示不限制模式。与主路由规则的 `clash_mode`
    /// 语义一致，见 `router::CompiledRule`。
    clash_mode_filter: Option<String>,
}

impl CompiledDnsRule {
    fn compile(
        rule: &DnsRuleConfig,
        upstreams: &HashMap<String, Arc<DnsUpstream>>,
        preloaded: &HashMap<String, Arc<RuleSet>>,
    ) -> anyhow::Result<Self> {
        let upstream = upstreams
            .get(&rule.server)
            .ok_or_else(|| anyhow::anyhow!("dns server '{}' not found", rule.server))?
            .clone();

        let mut lines = Vec::new();
        for d in &rule.domain {
            lines.push(format!("domain: {d}"));
        }
        for d in &rule.domain_suffix {
            lines.push(format!("domain-suffix: {d}"));
        }
        for d in &rule.domain_keyword {
            lines.push(format!("domain-keyword: {d}"));
        }

        let inline_rs = if lines.is_empty() {
            None
        } else {
            Some(Arc::new(RuleSet::from_text(&lines.join("\n"))?))
        };

        let mut file_rulesets = Vec::new();
        for tag in &rule.ruleset {
            if let Some(rs) = preloaded.get(tag) {
                file_rulesets.push(rs.clone());
            } else {
                tracing::warn!(tag=%tag, "dns rule references unloaded ruleset, skipping");
            }
        }

        Ok(Self {
            inbound_tags: rule.inbound.clone(),
            query_types: rule
                .query_type
                .iter()
                .map(|qt| match qt {
                    DnsQueryType::A => 1u16,
                    DnsQueryType::Aaaa => 28,
                    DnsQueryType::Cname => 5,
                    DnsQueryType::Mx => 15,
                    DnsQueryType::Txt => 16,
                    DnsQueryType::Ns => 2,
                    DnsQueryType::Ptr => 12,
                    DnsQueryType::Srv => 33,
                    DnsQueryType::Https => 65,
                })
                .collect(),
            inline_rs,
            file_rulesets,
            upstream,
            disable_cache: rule.disable_cache,
            clash_mode_filter: rule.clash_mode.clone(),
        })
    }

    fn matches(&self, inbound_tag: &str, qname: &str, qtype: u16, current_mode: &str) -> bool {
        // Clash API 模式过滤（不受其他条件影响的硬性前置过滤）。
        if let Some(mode) = &self.clash_mode_filter {
            if !mode.eq_ignore_ascii_case(current_mode) {
                return false;
            }
        }
        if !self.inbound_tags.is_empty() && !self.inbound_tags.iter().any(|t| t == inbound_tag) {
            return false;
        }
        if !self.query_types.is_empty() && !self.query_types.contains(&qtype) {
            return false;
        }
        let has_cond = self.inline_rs.is_some() || !self.file_rulesets.is_empty();
        if has_cond {
            let mt = MatchTarget::Domain(qname);
            let hit = self.inline_rs.as_ref().is_some_and(|rs| rs.matches(&mt))
                || self.file_rulesets.iter().any(|rs| rs.matches(&mt));
            if !hit {
                return false;
            }
        }
        true
    }
}

// ── DNS wire-format 辅助 ──────────────────────────────────────────────────────

pub fn extract_qname(msg: &[u8]) -> Option<String> {
    if msg.len() < 13 {
        return None;
    }
    let mut pos = 12usize; // 跳过 12 字节 header
    let mut labels = Vec::new();
    // 限制压缩指针跳转次数，防止恶意构造的循环指针导致死循环
    let mut jumps = 0u16;
    const MAX_JUMPS: u16 = 16;
    loop {
        if pos >= msg.len() {
            return None;
        }
        let len = msg[pos] as usize;
        if len == 0 {
            // 根域名，名字结束
            break;
        }
        if len & 0xC0 == 0xC0 {
            // 压缩指针（RFC 1035 §4.1.4）：高 2 位 = 11，低 14 位为消息内偏移。
            // 旧实现遇到指针直接 break，导致 QNAME 被截断（响应报文中
            // Question 段的 QNAME 常用压缩指针引用先前出现的名字）。
            if pos + 1 >= msg.len() {
                return None;
            }
            let offset = (((len & 0x3F) as usize) << 8) | (msg[pos + 1] as usize);
            // 名字不会从 header 内开始
            if offset < 12 {
                return None;
            }
            // RFC 1035 要求指针指向 prior occurrence（向前指）；
            // 向后指会形成环路导致死循环，直接拒绝。
            if offset >= pos {
                return None;
            }
            if jumps >= MAX_JUMPS {
                return None;
            }
            jumps += 1;
            pos = offset;
            continue;
        }
        // 普通标签
        pos += 1;
        if pos + len > msg.len() {
            return None;
        }
        labels.push(String::from_utf8_lossy(&msg[pos..pos + len]).into_owned());
        pos += len;
    }
    if labels.is_empty() {
        None
    } else {
        Some(labels.join("."))
    }
}

pub fn extract_qtype(msg: &[u8]) -> Option<u16> {
    if msg.len() < 13 {
        return None;
    }
    let mut pos = 12;
    loop {
        if pos >= msg.len() {
            return None;
        }
        let len = msg[pos] as usize;
        if len == 0 {
            pos += 1;
            break;
        }
        if len & 0xC0 == 0xC0 {
            pos += 2;
            break;
        }
        pos += 1 + len;
    }
    if pos + 2 > msg.len() {
        return None;
    }
    Some(u16::from_be_bytes([msg[pos], msg[pos + 1]]))
}

fn patch_id(resp: Bytes, query: &[u8]) -> Bytes {
    if resp.len() >= 2 && query.len() >= 2 {
        let mut v = resp.to_vec();
        v[0] = query[0];
        v[1] = query[1];
        Bytes::from(v)
    } else {
        resp
    }
}

/// 原 is_cacheable：只缓存 NOERROR + ANCOUNT>0
#[allow(dead_code)]
fn is_cacheable(resp: &[u8]) -> bool {
    if resp.len() < 12 {
        return false;
    }
    let rcode = resp[3] & 0x0F;
    let ancount = u16::from_be_bytes([resp[6], resp[7]]);
    rcode == 0 && ancount > 0
}

/// 扩展版：同时缓存负应答（NXDOMAIN / NOERROR-empty），以 SOA minimum TTL 为准。
/// 参照 sing-box extractNegativeTTL，避免对不存在域名反复查询上游。
fn is_cacheable_or_negative(resp: &[u8]) -> bool {
    if resp.len() < 12 {
        return false;
    }
    let rcode = resp[3] & 0x0F;
    // NOERROR(0) + ANCOUNT>0 → 正向缓存
    if rcode == 0 && u16::from_be_bytes([resp[6], resp[7]]) > 0 {
        return true;
    }
    // NXDOMAIN(3) 或 NOERROR + 无 answer → 负向缓存（若有 SOA TTL）
    if rcode == 0 || rcode == 3 {
        return extract_soa_ttl(resp).is_some();
    }
    false
}

/// 提取 min TTL（正向应答用），或 SOA minimum（负向应答用）。
fn extract_min_ttl_or_negative(resp: &[u8]) -> Option<u32> {
    if resp.len() < 12 {
        return None;
    }
    let rcode = resp[3] & 0x0F;
    let ancount = u16::from_be_bytes([resp[6], resp[7]]);

    if (rcode == 0 || rcode == 3) && ancount == 0 {
        // 负应答：用 SOA minimum，默认最多 300s 避免缓存太久
        return Some(extract_soa_ttl(resp).unwrap_or(300).min(300));
    }
    extract_min_ttl(resp)
}

/// 从 Authority 区提取 SOA minimum TTL（负应答缓存 TTL 依据）。
/// 参照 sing-box extractNegativeTTL：min(soaTTL, soaMinimum)。
fn extract_soa_ttl(resp: &[u8]) -> Option<u32> {
    // 简单扫描 Authority section：NSCOUNT 个 RR，寻找 TYPE=SOA(6)
    if resp.len() < 12 {
        return None;
    }
    let nscount = u16::from_be_bytes([resp[8], resp[9]]) as usize;
    if nscount == 0 {
        return None;
    }
    let ancount = u16::from_be_bytes([resp[6], resp[7]]) as usize;
    // 跳过 Question section
    let mut pos = 12;
    loop {
        if pos >= resp.len() {
            return None;
        }
        let l = resp[pos] as usize;
        if l == 0 {
            pos += 1;
            break;
        }
        if l & 0xC0 == 0xC0 {
            pos += 2;
            break;
        }
        pos += 1 + l;
    }
    pos += 4; // QTYPE + QCLASS
              // 跳过 Answer section
    for _ in 0..ancount {
        pos = skip_rr(resp, pos)?;
    }
    // 扫描 Authority section 找 SOA
    for _ in 0..nscount {
        let rr_start = pos;
        pos = skip_name(resp, pos)?;
        if pos + 10 > resp.len() {
            return None;
        }
        let rr_type = u16::from_be_bytes([resp[pos], resp[pos + 1]]);
        let rr_ttl =
            u32::from_be_bytes([resp[pos + 4], resp[pos + 5], resp[pos + 6], resp[pos + 7]]);
        let _rdlength = u16::from_be_bytes([resp[pos + 8], resp[pos + 9]]) as usize;
        pos += 10;
        if rr_type == 6 {
            // SOA: MNAME + RNAME + serial(4) + refresh(4) + retry(4) + expire(4) + minimum(4)
            // 跳过 MNAME 和 RNAME 两个域名，定位 minimum 字段
            let mut soa_pos = pos;
            soa_pos = skip_name(resp, soa_pos)?;
            soa_pos = skip_name(resp, soa_pos)?;
            if soa_pos + 20 > resp.len() {
                return None;
            }
            let minimum = u32::from_be_bytes([
                resp[soa_pos + 16],
                resp[soa_pos + 17],
                resp[soa_pos + 18],
                resp[soa_pos + 19],
            ]);
            return Some(rr_ttl.min(minimum));
        }
        pos = rr_start;
        pos = skip_rr(resp, pos)?;
    }
    None
}

fn skip_name(msg: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        if pos >= msg.len() {
            return None;
        }
        let l = msg[pos] as usize;
        if l == 0 {
            return Some(pos + 1);
        }
        if l & 0xC0 == 0xC0 {
            return Some(pos + 2);
        }
        pos += 1 + l;
    }
}

fn skip_rr(msg: &[u8], pos: usize) -> Option<usize> {
    let pos = skip_name(msg, pos)?;
    if pos + 10 > msg.len() {
        return None;
    }
    let rdlength = u16::from_be_bytes([msg[pos + 8], msg[pos + 9]]) as usize;
    Some(pos + 10 + rdlength)
}

fn extract_min_ttl(resp: &[u8]) -> Option<u32> {
    if resp.len() < 12 {
        return None;
    }
    let ancount = u16::from_be_bytes([resp[6], resp[7]]) as usize;
    if ancount == 0 {
        return None;
    }
    let mut pos = 12;
    loop {
        if pos >= resp.len() {
            return None;
        }
        let len = msg_label_len(resp, pos)?;
        if len == 0 {
            pos += 1;
            break;
        }
        if len & 0xC0 == 0xC0 {
            pos += 2;
            break;
        }
        pos += 1 + len;
    }
    pos += 4; // QTYPE + QCLASS
    let mut min_ttl = u32::MAX;
    for _ in 0..ancount {
        if pos >= resp.len() {
            break;
        }
        if resp[pos] & 0xC0 == 0xC0 {
            pos += 2;
        } else {
            loop {
                if pos >= resp.len() {
                    return None;
                }
                let l = resp[pos] as usize;
                if l == 0 {
                    pos += 1;
                    break;
                }
                pos += 1 + l;
            }
        }
        if pos + 10 > resp.len() {
            break;
        }
        let ttl = u32::from_be_bytes(resp[pos + 4..pos + 8].try_into().ok()?);
        let rdlength = u16::from_be_bytes([resp[pos + 8], resp[pos + 9]]) as usize;
        pos += 10 + rdlength;
        if ttl < min_ttl {
            min_ttl = ttl;
        }
    }
    if min_ttl == u32::MAX {
        None
    } else {
        Some(min_ttl)
    }
}

fn msg_label_len(msg: &[u8], pos: usize) -> Option<usize> {
    msg.get(pos).map(|&b| b as usize)
}

pub fn make_servfail(query: &[u8]) -> Bytes {
    let mut resp = [0u8; 12];
    if query.len() >= 2 {
        resp[0] = query[0];
        resp[1] = query[1];
    }
    resp[2] = 0x80;
    resp[3] = 0x02;
    Bytes::copy_from_slice(&resp)
}

pub fn make_refused(query: &[u8]) -> Bytes {
    let mut v = make_servfail(query).to_vec();
    v[3] = 0x05;
    Bytes::from(v)
}

pub fn make_noerror_empty(query: &[u8]) -> Bytes {
    let mut v = make_servfail(query).to_vec();
    v[3] = 0x00;
    Bytes::from(v)
}

pub fn make_nxdomain(query: &[u8]) -> Bytes {
    let mut v = make_servfail(query).to_vec();
    v[3] = 0x03;
    Bytes::from(v)
}

pub fn build_query_bytes(name: &str, qtype: u16) -> Vec<u8> {
    build_query(name, qtype)
}

pub fn extract_first_ip_from_resp(resp: &[u8], qtype: u16) -> Option<std::net::IpAddr> {
    extract_first_ip(resp, qtype)
}

fn build_query(name: &str, qtype: u16) -> Vec<u8> {
    let mut msg = vec![
        0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
    for label in name.split('.') {
        if label.is_empty() {
            continue;
        }
        msg.push(label.len() as u8);
        msg.extend_from_slice(label.as_bytes());
    }
    msg.push(0x00);
    msg.extend_from_slice(&qtype.to_be_bytes());
    msg.extend_from_slice(&[0x00, 0x01]);
    msg
}

fn extract_first_ip(resp: &[u8], qtype: u16) -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    if resp.len() < 12 {
        return None;
    }
    let ancount = u16::from_be_bytes([resp[6], resp[7]]) as usize;
    if ancount == 0 {
        return None;
    }
    let mut pos = 12;
    loop {
        if pos >= resp.len() {
            return None;
        }
        let len = resp[pos] as usize;
        if len == 0 {
            pos += 1;
            break;
        }
        if len & 0xC0 == 0xC0 {
            pos += 2;
            break;
        }
        pos += 1 + len;
    }
    pos += 4;
    for _ in 0..ancount {
        if pos >= resp.len() {
            break;
        }
        if resp[pos] & 0xC0 == 0xC0 {
            pos += 2;
        } else {
            loop {
                if pos >= resp.len() {
                    return None;
                }
                let l = resp[pos] as usize;
                if l == 0 {
                    pos += 1;
                    break;
                }
                pos += 1 + l;
            }
        }
        if pos + 10 > resp.len() {
            break;
        }
        let rr_type = u16::from_be_bytes([resp[pos], resp[pos + 1]]);
        let rdlength = u16::from_be_bytes([resp[pos + 8], resp[pos + 9]]) as usize;
        pos += 10;
        if pos + rdlength > resp.len() {
            break;
        }
        if rr_type == qtype {
            match qtype {
                1 if rdlength == 4 => {
                    return Some(IpAddr::V4(Ipv4Addr::new(
                        resp[pos],
                        resp[pos + 1],
                        resp[pos + 2],
                        resp[pos + 3],
                    )))
                }
                28 if rdlength == 16 => {
                    let mut o = [0u8; 16];
                    o.copy_from_slice(&resp[pos..pos + 16]);
                    return Some(IpAddr::V6(Ipv6Addr::from(o)));
                }
                _ => {}
            }
        }
        pos += rdlength;
    }
    None
}

/// 与 `extract_first_ip` 平行的实现：不是命中第一条就返回，而是收集**全部**
/// 匹配 `qtype` 的记录。供 `resolve_domain_all`（Happy Eyeballs 多候选拨号）
/// 使用。刻意不复用 `extract_first_ip` 内部逻辑（哪怕有重复），是为了不去碰
/// 已经过充分测试的原函数，降低改动风险。
fn extract_all_ips(resp: &[u8], qtype: u16) -> Vec<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    let mut out = Vec::new();
    if resp.len() < 12 {
        return out;
    }
    let ancount = u16::from_be_bytes([resp[6], resp[7]]) as usize;
    if ancount == 0 {
        return out;
    }
    let mut pos = 12;
    loop {
        if pos >= resp.len() {
            return out;
        }
        let len = resp[pos] as usize;
        if len == 0 {
            pos += 1;
            break;
        }
        if len & 0xC0 == 0xC0 {
            pos += 2;
            break;
        }
        pos += 1 + len;
    }
    pos += 4;
    for _ in 0..ancount {
        if pos >= resp.len() {
            break;
        }
        if resp[pos] & 0xC0 == 0xC0 {
            pos += 2;
        } else {
            loop {
                if pos >= resp.len() {
                    return out;
                }
                let l = resp[pos] as usize;
                if l == 0 {
                    pos += 1;
                    break;
                }
                pos += 1 + l;
            }
        }
        if pos + 10 > resp.len() {
            break;
        }
        let rr_type = u16::from_be_bytes([resp[pos], resp[pos + 1]]);
        let rdlength = u16::from_be_bytes([resp[pos + 8], resp[pos + 9]]) as usize;
        pos += 10;
        if pos + rdlength > resp.len() {
            break;
        }
        if rr_type == qtype {
            match qtype {
                1 if rdlength == 4 => {
                    out.push(IpAddr::V4(Ipv4Addr::new(
                        resp[pos],
                        resp[pos + 1],
                        resp[pos + 2],
                        resp[pos + 3],
                    )));
                }
                28 if rdlength == 16 => {
                    let mut o = [0u8; 16];
                    o.copy_from_slice(&resp[pos..pos + 16]);
                    out.push(IpAddr::V6(Ipv6Addr::from(o)));
                }
                _ => {}
            }
        }
        pos += rdlength;
    }
    out
}

// ── 拓扑排序 ──────────────────────────────────────────────────────────────────

fn toposort_servers(servers: &[crate::config::dns::DnsServerConfig]) -> anyhow::Result<Vec<usize>> {
    let n = servers.len();
    let tag_to_idx: HashMap<&str, usize> = servers
        .iter()
        .enumerate()
        .map(|(i, s)| (s.tag.as_str(), i))
        .collect();
    let mut in_degree = vec![0usize; n];
    let mut deps: Vec<Option<usize>> = vec![None; n];
    for (i, srv) in servers.iter().enumerate() {
        if let Some(ref tag) = srv.domain_resolver {
            let j = *tag_to_idx.get(tag.as_str()).ok_or_else(|| {
                anyhow::anyhow!(
                    "dns server '{}' domain_resolver '{}' not found",
                    srv.tag,
                    tag
                )
            })?;
            deps[i] = Some(j);
            in_degree[i] += 1;
            if let Some(k) = deps[j] {
                if k == i {
                    anyhow::bail!(
                        "dns server domain_resolver cycle between '{}' and '{}'",
                        servers[i].tag,
                        servers[j].tag
                    );
                }
            }
        }
    }
    let mut queue: std::collections::VecDeque<usize> =
        (0..n).filter(|&i| in_degree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);
    while let Some(node) = queue.pop_front() {
        order.push(node);
        for i in 0..n {
            if deps[i] == Some(node) {
                in_degree[i] -= 1;
                if in_degree[i] == 0 {
                    queue.push_back(i);
                }
            }
        }
    }
    if order.len() != n {
        anyhow::bail!("dns server domain_resolver has a cycle");
    }
    Ok(order)
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_query(name: &str, qtype: u16) -> Vec<u8> {
        let mut msg = vec![
            0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        for label in name.split('.') {
            msg.push(label.len() as u8);
            msg.extend_from_slice(label.as_bytes());
        }
        msg.push(0x00);
        msg.extend_from_slice(&qtype.to_be_bytes());
        msg.extend_from_slice(&[0x00, 0x01]);
        msg
    }

    /// 构造一个最小可用的 DNS 响应报文：1 条问题 + 任意条答案记录
    /// （NAME 用指针压缩指向 offset 12 处的问题段，和真实 DNS 报文一致）。
    fn make_response_with_records(
        qname: &str,
        qtype_for_question: u16,
        records: &[(u16, Vec<u8>)],
    ) -> Vec<u8> {
        let mut msg = Vec::new();
        msg.extend_from_slice(&[0x00, 0x01]); // ID
        msg.extend_from_slice(&[0x81, 0x80]); // flags: response, RD+RA
        msg.extend_from_slice(&[0x00, 0x01]); // QDCOUNT=1
        msg.extend_from_slice(&(records.len() as u16).to_be_bytes()); // ANCOUNT
        msg.extend_from_slice(&[0x00, 0x00]); // NSCOUNT
        msg.extend_from_slice(&[0x00, 0x00]); // ARCOUNT

        for label in qname.split('.') {
            msg.push(label.len() as u8);
            msg.extend_from_slice(label.as_bytes());
        }
        msg.push(0x00);
        msg.extend_from_slice(&qtype_for_question.to_be_bytes());
        msg.extend_from_slice(&[0x00, 0x01]); // QCLASS=IN

        for (rtype, rdata) in records {
            msg.extend_from_slice(&[0xC0, 0x0C]); // NAME：指针压缩，指向 offset 12
            msg.extend_from_slice(&rtype.to_be_bytes());
            msg.extend_from_slice(&[0x00, 0x01]); // CLASS=IN
            msg.extend_from_slice(&[0x00, 0x00, 0x0E, 0x10]); // TTL=3600
            msg.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
            msg.extend_from_slice(rdata);
        }
        msg
    }

    #[test]
    fn extract_all_ips_collects_multiple_a_records() {
        let resp = make_response_with_records(
            "example.com",
            1,
            &[(1, vec![1, 2, 3, 4]), (1, vec![5, 6, 7, 8])],
        );
        let ips = extract_all_ips(&resp, 1);
        assert_eq!(
            ips,
            vec![
                "1.2.3.4".parse::<std::net::IpAddr>().unwrap(),
                "5.6.7.8".parse::<std::net::IpAddr>().unwrap(),
            ]
        );
    }

    #[test]
    fn extract_all_ips_empty_when_qtype_not_present() {
        let resp = make_response_with_records("example.com", 1, &[(1, vec![1, 2, 3, 4])]);
        // 响应里只有 A 记录，找 AAAA 应该返回空，而不是 panic 或返回错误类型的值
        assert!(extract_all_ips(&resp, 28).is_empty());
    }

    #[test]
    fn extract_all_ips_filters_by_qtype_in_mixed_response() {
        let v6_bytes = std::net::Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 1)
            .octets()
            .to_vec();
        let resp = make_response_with_records(
            "example.com",
            1,
            &[(1, vec![9, 9, 9, 9]), (28, v6_bytes)],
        );
        assert_eq!(
            extract_all_ips(&resp, 1),
            vec!["9.9.9.9".parse::<std::net::IpAddr>().unwrap()]
        );
        assert_eq!(
            extract_all_ips(&resp, 28),
            vec!["2001:db8::1".parse::<std::net::IpAddr>().unwrap()]
        );
    }

    #[test]
    fn extract_qname_basic() {
        assert_eq!(
            extract_qname(&make_query("www.google.com", 1)),
            Some("www.google.com".into())
        );
    }

    #[test]
    fn extract_qtype_a() {
        assert_eq!(extract_qtype(&make_query("x.com", 1)), Some(1));
    }

    #[test]
    fn extract_qtype_aaaa() {
        assert_eq!(extract_qtype(&make_query("x.com", 28)), Some(28));
    }

    #[test]
    fn patch_id_works() {
        let query = make_query("x.com", 1);
        let mut resp = query.clone();
        resp[0] = 0xFF;
        resp[1] = 0xFF;
        let patched = patch_id(Bytes::from(resp), &query);
        assert_eq!(patched[0], query[0]);
        assert_eq!(patched[1], query[1]);
    }

    #[test]
    fn rcode_values() {
        let q = &make_query("a.com", 1);
        assert_eq!(make_refused(q)[3] & 0x0F, 5);
        assert_eq!(make_noerror_empty(q)[3] & 0x0F, 0);
        assert_eq!(make_nxdomain(q)[3] & 0x0F, 3);
    }

    #[test]
    fn is_cacheable_false_no_answer() {
        assert!(!is_cacheable(&make_query("a.com", 1)));
    }

    #[test]
    fn negative_ttl_nxdomain_without_soa_not_cached() {
        // NXDOMAIN 无 SOA → 不缓存
        let mut resp = make_query("nx.com", 1);
        resp[3] = 0x83; // QR=1 RCODE=NXDOMAIN
        assert!(!is_cacheable_or_negative(&resp));
    }
}

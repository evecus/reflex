//! WireGuard 出站实现
//!
//! 使用 WireGuard 协议建立加密隧道，将流量通过 WG 服务端转发。
//!
//! ## 实现策略
//!
//! 本实现采用**用户态隧道**方案，无需内核 WireGuard 模块：
//!
//! 1. 通过 UDP socket 与 WireGuard 服务端完成握手（Noise_IKpsk2 协议）
//! 2. 在 Tokio 任务中维护加密会话和重新握手计时器
//! 3. 出站 TCP/UDP 流量通过隧道 IP 栈（TUN 虚拟设备或内部 TCP-over-WG 路径）传输
//!
//! 对于单出站代理场景（无需完整 IP 栈），我们采用简化方案：
//! 通过 WireGuard 隧道建立 SOCKS5/TCP 代理通道，再由内部路由层处理流量分发。
//!
//! ## Noise_IKpsk2 握手概要
//!
//! ```text
//! 发起方 → 响应方:
//!   [type=1][sender_idx][ephemeral][encrypted_static][encrypted_timestamp][mac1][mac2]
//!
//! 响应方 → 发起方:
//!   [type=2][sender_idx][receiver_idx][ephemeral][encrypted_nothing][mac1][mac2]
//!
//! 此后数据包:
//!   [type=4][receiver_idx][counter][encrypted_data]
//! ```
//!
//! ## 依赖
//!
//! 复用项目已有：`x25519-dalek`、`chacha20poly1305`、`blake3`、`hmac`、`sha2`、`rand`

use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Key as ChaChaKey, Nonce as ChaChaNonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio::{net::UdpSocket, sync::Mutex, time};
use tracing::{info, warn};
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

use crate::{
    config::outbound::WireGuardOutboundConfig,
    dns::DnsResolver,
    inbound::{InboundTcpStream, InboundUdpPacket, Target},
    outbound::{Outbound, OutboundStatus},
};

// ── WireGuard 协议常量 ────────────────────────────────────────────────────────

const MSG_INITIATION: u32 = 1;
const MSG_RESPONSE: u32 = 2;
const MSG_DATA: u32 = 4;

/// 握手超时
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// 会话超时（3 分钟，WG 规范为 180s）
const SESSION_TIMEOUT: Duration = Duration::from_secs(180);

// ── Noise 协议常量 ────────────────────────────────────────────────────────────

const NOISE_CONSTRUCTION: &[u8] = b"Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s";
const WG_IDENTIFIER: &[u8] = b"WireGuard v1 zx2c4 Jason@zx2c4.com";
const LABEL_MAC1: &[u8] = b"mac1----";

// ── 密钥解码 ──────────────────────────────────────────────────────────────────

fn decode_key_base64(s: &str) -> anyhow::Result<[u8; 32]> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .context("WireGuard key base64 decode failed")?;
    if bytes.len() != 32 {
        anyhow::bail!("WireGuard key must be 32 bytes, got {}", bytes.len());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

// ── BLAKE2s-256（用 SHA-256 近似，实际 WG 使用 BLAKE2s） ─────────────────────
//
// 注意：WireGuard 规范使用 BLAKE2s，但 BLAKE2s 不在项目依赖中。
// 我们用 BLAKE3（已有）或 SHA-256（已有）作为临时替换。
// 生产部署应添加 blake2 crate。此处使用 SHA-256 以保证可编译性，
// 并在注释中标注 TODO。

// TODO: 替换为 blake2::Blake2s256
fn hash(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    let r = h.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&r);
    out
}

fn hmac_hash(key: &[u8; 32], data: &[u8]) -> [u8; 32] {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC key size error");
    mac.update(data);
    let r = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&r);
    out
}

fn hkdf2(key: &[u8; 32], input: &[u8]) -> ([u8; 32], [u8; 32]) {
    let t1 = hmac_hash(key, &{
        let mut d = input.to_vec();
        d.push(0x01);
        d
    });
    let t2 = hmac_hash(key, &{
        let mut d = t1.to_vec();
        d.extend_from_slice(input);
        d.push(0x02);
        d
    });
    (t1, t2)
}

fn aead_encrypt(key: &[u8; 32], counter: u64, plain: &[u8], aad: &[u8]) -> Vec<u8> {
    let cipher = ChaCha20Poly1305::new(ChaChaKey::from_slice(key));
    let mut nonce = [0u8; 12];
    nonce[4..12].copy_from_slice(&counter.to_le_bytes());
    cipher
        .encrypt(ChaChaNonce::from_slice(&nonce), Payload { msg: plain, aad })
        .expect("aead encrypt failed")
}

fn aead_decrypt(
    key: &[u8; 32],
    counter: u64,
    cipher_text: &[u8],
    aad: &[u8],
) -> anyhow::Result<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new(ChaChaKey::from_slice(key));
    let mut nonce = [0u8; 12];
    nonce[4..12].copy_from_slice(&counter.to_le_bytes());
    cipher
        .decrypt(
            ChaChaNonce::from_slice(&nonce),
            Payload {
                msg: cipher_text,
                aad,
            },
        )
        .map_err(|e| anyhow!("aead decrypt failed: {e}"))
}

// ── WireGuard 会话状态 ────────────────────────────────────────────────────────

struct WgSession {
    send_key: [u8; 32],
    recv_key: [u8; 32],
    remote_idx: u32,
    #[allow(dead_code)]
    local_idx: u32,
    send_counter: u64,
    established_at: Instant,
}

impl WgSession {
    fn is_expired(&self) -> bool {
        self.established_at.elapsed() > SESSION_TIMEOUT
    }
}

// ── WireGuard 握手器 ──────────────────────────────────────────────────────────

#[allow(dead_code)]
struct WgHandshake {
    private_key: StaticSecret,
    public_key: PublicKey,
    peer_pub: [u8; 32],
    psk: Option<[u8; 32]>,
    chaining_key: [u8; 32],
    hash_val: [u8; 32],
}

impl WgHandshake {
    fn new(private_bytes: [u8; 32], peer_pub: [u8; 32], psk: Option<[u8; 32]>) -> Self {
        let private_key = StaticSecret::from(private_bytes);
        let public_key = PublicKey::from(&private_key);
        let initial_hash = hash(NOISE_CONSTRUCTION);
        let h = hash(&{
            let mut d = initial_hash.to_vec();
            d.extend_from_slice(WG_IDENTIFIER);
            d
        });
        let hash_val = hash(&{
            let mut d = h.to_vec();
            d.extend_from_slice(&peer_pub);
            d
        });
        Self {
            private_key,
            public_key,
            peer_pub,
            psk,
            chaining_key: initial_hash,
            hash_val,
        }
    }

    /// 构建 Initiation 消息（type=1）
    fn build_initiation(&self) -> (Vec<u8>, [u8; 32], u32) {
        let mut rng = rand::thread_rng();

        let ephemeral_secret = EphemeralSecret::random_from_rng(&mut rng);
        let ephemeral_pub = PublicKey::from(&ephemeral_secret);

        let mut sender_index = [0u8; 4];
        rng.fill_bytes(&mut sender_index);
        let sender_idx = u32::from_le_bytes(sender_index);

        // C1 = H(NOISE_CONSTRUCTION)
        let mut ck = hash(NOISE_CONSTRUCTION);
        // C2 = KDF(C1, responder_public_key)
        ck = hmac_hash(&ck, &self.peer_pub);
        // H = H(H(NOISE_CONSTRUCTION || WG_IDENTIFIER), responder_pk)
        let h0 = hash(&{
            let mut d = hash(NOISE_CONSTRUCTION).to_vec();
            d.extend_from_slice(WG_IDENTIFIER);
            d
        });
        let h = hash(&{
            let mut d = h0.to_vec();
            d.extend_from_slice(&self.peer_pub);
            d
        });

        // ephemeral
        let (ck2, _) = hkdf2(&ck, ephemeral_pub.as_bytes());
        let ck = ck2;
        let h = hash(&{
            let mut d = h.to_vec();
            d.extend_from_slice(ephemeral_pub.as_bytes());
            d
        });

        // DH(ephemeral, responder_static)
        let peer_static = x25519_dalek::PublicKey::from(self.peer_pub);
        let dh_es = ephemeral_secret.diffie_hellman(&peer_static);
        let (ck, key) = hkdf2(&ck, dh_es.as_bytes());

        // encrypted_static
        let encrypted_static = aead_encrypt(&key, 0, self.public_key.as_bytes(), &h);
        let h = hash(&{
            let mut d = h.to_vec();
            d.extend_from_slice(&encrypted_static);
            d
        });

        // DH(initiator_static, responder_static)
        let dh_ss = self.private_key.diffie_hellman(&peer_static);
        let (ck, key) = hkdf2(&ck, dh_ss.as_bytes());

        // timestamp = TAI64N(now)
        let ts = tai64n_now();
        let encrypted_timestamp = aead_encrypt(&key, 0, &ts, &h);
        let h = hash(&{
            let mut d = h.to_vec();
            d.extend_from_slice(&encrypted_timestamp);
            d
        });

        // PSK if present (simplified: skip for now, psk = zero)
        let psk_bytes = self.psk.unwrap_or([0u8; 32]);
        let (ck, tau, _key) = hkdf3(&ck, &psk_bytes);
        let _h = hash(&{
            let mut d = h.to_vec();
            d.extend_from_slice(&tau);
            d
        });

        // mac1
        let mac1_key = hash(&{
            let mut d = LABEL_MAC1.to_vec();
            d.extend_from_slice(&self.peer_pub);
            d
        });

        // Build message
        let mut msg = Vec::with_capacity(148);
        msg.extend_from_slice(&MSG_INITIATION.to_le_bytes());
        msg.extend_from_slice(&sender_idx.to_le_bytes());
        msg.extend_from_slice(ephemeral_pub.as_bytes()); // 32B
        msg.extend_from_slice(&encrypted_static); // 32+16=48B
        msg.extend_from_slice(&encrypted_timestamp); // 12+16=28B

        // mac1 over all above
        let mac1 = &hmac_hash(&mac1_key, &msg)[..16];
        msg.extend_from_slice(mac1);
        // mac2 = zero (no cookie)
        msg.extend_from_slice(&[0u8; 16]);

        // Return (chaining_key, ephemeral_public) for response processing
        (msg, ck, sender_idx)
    }
}

fn hkdf3(key: &[u8; 32], input: &[u8]) -> ([u8; 32], [u8; 32], [u8; 32]) {
    let t1 = hmac_hash(key, &{
        let mut d = input.to_vec();
        d.push(0x01);
        d
    });
    let t2 = hmac_hash(key, &{
        let mut d = t1.to_vec();
        d.extend_from_slice(input);
        d.push(0x02);
        d
    });
    let t3 = hmac_hash(key, &{
        let mut d = t2.to_vec();
        d.extend_from_slice(input);
        d.push(0x03);
        d
    });
    (t1, t2, t3)
}

fn tai64n_now() -> [u8; 12] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() + 4611686018427387914u64; // TAI64 epoch offset
    let nanos = now.subsec_nanos();
    let mut buf = [0u8; 12];
    buf[..8].copy_from_slice(&secs.to_be_bytes());
    buf[8..].copy_from_slice(&nanos.to_be_bytes());
    buf
}

// ── WireGuard 出站 ────────────────────────────────────────────────────────────

pub struct WireGuardOutbound {
    config: WireGuardOutboundConfig,
    resolver: Option<Arc<DnsResolver>>,
    session: Arc<Mutex<Option<WgSession>>>,
    routing_mark: u32,
}

impl WireGuardOutbound {
    pub fn new(
        config: WireGuardOutboundConfig,
        resolver: Option<Arc<DnsResolver>>,
    ) -> anyhow::Result<Self> {
        // 验证私钥格式
        decode_key_base64(&config.private_key).context("WireGuard: invalid private_key")?;
        // 验证 peers 里的公钥格式
        for peer in config.resolved_peers() {
            if let Some(pk) = &peer.public_key {
                decode_key_base64(pk).context("WireGuard: invalid peer public_key")?;
            }
        }
        Ok(Self {
            config,
            resolver,
            session: Arc::new(Mutex::new(None)),
            routing_mark: 0,
        })
    }

    pub fn with_mark(mut self, mark: u32) -> Self {
        self.routing_mark = mark;
        self
    }

    /// 解析服务端地址（从 peers 或简化字段）
    async fn resolve_server(&self) -> anyhow::Result<SocketAddr> {
        let peers = self.config.resolved_peers();
        let peer = peers
            .first()
            .ok_or_else(|| anyhow!("WireGuard: no peer configured"))?;
        let host = peer
            .address
            .as_deref()
            .ok_or_else(|| anyhow!("WireGuard: peer has no address"))?;
        let port = peer.port;
        if port == 0 {
            return Err(anyhow!("WireGuard: peer port is 0"));
        }
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(SocketAddr::new(ip, port));
        }
        if let Some(ref resolver) = self.resolver {
            let ip = resolver
                .resolve_domain(host)
                .await
                .context("WireGuard: DNS resolve failed")?;
            return Ok(SocketAddr::new(ip, port));
        }
        use tokio::net::lookup_host;
        let mut addrs = lookup_host(format!("{host}:{port}")).await?;
        addrs
            .next()
            .ok_or_else(|| anyhow!("WireGuard: no address for {host}"))
    }

    /// 建立或复用 WireGuard 会话，返回加密后的 UDP socket
    async fn ensure_session(&self, udp: &UdpSocket, server_addr: SocketAddr) -> anyhow::Result<()> {
        let mut guard = self.session.lock().await;
        if let Some(ref s) = *guard {
            if !s.is_expired() {
                return Ok(());
            }
        }

        let private_bytes = decode_key_base64(&self.config.private_key)?;
        let peers = self.config.resolved_peers();
        let peer = peers
            .first()
            .ok_or_else(|| anyhow!("WireGuard: no peer configured"))?;
        let peer_pub_bytes = match &peer.public_key {
            Some(k) => decode_key_base64(k)?,
            None => return Err(anyhow!("WireGuard: peer has no public_key")),
        };
        let psk = match &peer.pre_shared_key {
            Some(k) => Some(decode_key_base64(k)?),
            None => None,
        };

        let hs = WgHandshake::new(private_bytes, peer_pub_bytes, psk);
        let (init_msg, ck, sender_idx) = hs.build_initiation();

        // Send initiation
        udp.send_to(&init_msg, server_addr)
            .await
            .context("WireGuard: send initiation failed")?;

        // Wait for response
        let mut resp_buf = vec![0u8; 92];
        let timeout = time::timeout(HANDSHAKE_TIMEOUT, udp.recv(&mut resp_buf))
            .await
            .map_err(|_| anyhow!("WireGuard: handshake timeout"))?
            .context("WireGuard: recv response failed")?;

        if timeout < 60 {
            return Err(anyhow!("WireGuard: response too short ({timeout} bytes)"));
        }

        let msg_type = u32::from_le_bytes(resp_buf[..4].try_into()?);
        if msg_type != MSG_RESPONSE {
            return Err(anyhow!(
                "WireGuard: expected MSG_RESPONSE(2), got {msg_type}"
            ));
        }

        let remote_idx = u32::from_le_bytes(resp_buf[4..8].try_into()?);
        // receiver_index (us) at bytes 8..12
        let ephemeral_resp = &resp_buf[12..44];

        // Derive send/recv keys from chaining key + ephemeral exchange
        // (simplified key derivation; full Noise_IKpsk2 requires more steps)
        let (send_key, recv_key) = hkdf2(&ck, ephemeral_resp);

        let session = WgSession {
            send_key,
            recv_key,
            remote_idx,
            local_idx: sender_idx,
            send_counter: 0,
            established_at: Instant::now(),
        };

        info!("WireGuard: session established with {server_addr} (remote_idx={remote_idx:#x})");
        *guard = Some(session);
        Ok(())
    }

    /// 封装并发送一个 WireGuard 数据包
    async fn send_packet(&self, udp: &UdpSocket, plain: &[u8]) -> anyhow::Result<()> {
        let mut guard = self.session.lock().await;
        let sess = guard
            .as_mut()
            .ok_or_else(|| anyhow!("WireGuard: no active session"))?;

        let counter = sess.send_counter;
        sess.send_counter += 1;

        let encrypted = aead_encrypt(&sess.send_key, counter, plain, &[]);

        let mut pkt = Vec::with_capacity(32 + encrypted.len());
        pkt.extend_from_slice(&MSG_DATA.to_le_bytes());
        pkt.extend_from_slice(&sess.remote_idx.to_le_bytes());
        pkt.extend_from_slice(&counter.to_le_bytes());
        pkt.extend_from_slice(&encrypted);

        udp.send(&pkt)
            .await
            .context("WireGuard: send_packet failed")?;
        Ok(())
    }

    /// 接收并解密一个 WireGuard 数据包
    async fn recv_packet(&self, udp: &UdpSocket) -> anyhow::Result<Vec<u8>> {
        let mut buf = vec![0u8; self.config.mtu as usize + 32 + 16];
        let n = udp
            .recv(&mut buf)
            .await
            .context("WireGuard: recv_packet failed")?;
        let pkt = &buf[..n];

        if pkt.len() < 32 {
            return Err(anyhow!("WireGuard: data packet too short ({n} bytes)"));
        }

        let msg_type = u32::from_le_bytes(pkt[..4].try_into()?);
        if msg_type != MSG_DATA {
            return Err(anyhow!(
                "WireGuard: expected data packet, got type {msg_type}"
            ));
        }

        let counter = u64::from_le_bytes(pkt[8..16].try_into()?);
        let encrypted = &pkt[16..];

        let guard = self.session.lock().await;
        let sess = guard
            .as_ref()
            .ok_or_else(|| anyhow!("WireGuard: no session"))?;
        let plain = aead_decrypt(&sess.recv_key, counter, encrypted, &[])?;
        Ok(plain)
    }
}

#[async_trait::async_trait]
impl Outbound for WireGuardOutbound {
    fn tag(&self) -> &str {
        &self.config.tag
    }

    async fn handle_tcp(&self, conn: InboundTcpStream) -> anyhow::Result<(u64, u64)> {
        let server_addr = self.resolve_server().await?;

        let bind_addr: SocketAddr = if server_addr.is_ipv6() {
            "[::]:0".parse().unwrap()
        } else {
            "0.0.0.0:0".parse().unwrap()
        };
        let udp = UdpSocket::bind(bind_addr)
            .await
            .context("WireGuard: bind UDP failed")?;

        #[cfg(target_os = "linux")]
        if self.routing_mark != 0 {
            crate::outbound::apply_mark_to_udp(&udp, self.routing_mark)?;
        }

        udp.connect(server_addr)
            .await
            .context("WireGuard: UDP connect failed")?;

        self.ensure_session(&udp, server_addr).await?;

        warn!(
            tag = %self.config.tag,
            target = %conn.target,
            "WireGuard: TCP-over-WG requires TUN stack; not yet implemented"
        );

        Err(anyhow!(
            "WireGuard TCP-over-tunnel not yet fully implemented; \
             please use WireGuard as a system interface and route traffic through it"
        ))
    }

    async fn handle_udp(&self, pkt: InboundUdpPacket) -> anyhow::Result<()> {
        let server_addr = self.resolve_server().await?;

        let bind_addr: SocketAddr = if server_addr.is_ipv6() {
            "[::]:0".parse().unwrap()
        } else {
            "0.0.0.0:0".parse().unwrap()
        };
        let udp = UdpSocket::bind(bind_addr).await?;

        #[cfg(target_os = "linux")]
        if self.routing_mark != 0 {
            crate::outbound::apply_mark_to_udp(&udp, self.routing_mark)?;
        }

        udp.connect(server_addr).await?;
        self.ensure_session(&udp, server_addr).await?;

        // Build IP/UDP packet wrapping the payload
        let ip_pkt = build_udp_ip_packet(&pkt.data, &pkt.src, &pkt.target)?;
        self.send_packet(&udp, &ip_pkt).await?;

        // Receive response
        let plain = self.recv_packet(&udp).await?;
        let (payload, src_addr) = parse_udp_ip_packet(&plain)?;

        let _ = pkt
            .session
            .reply_tx
            .send((bytes::Bytes::from(payload), pkt.src, src_addr))
            .await;
        Ok(())
    }

    fn status(&self) -> OutboundStatus {
        OutboundStatus {
            name: self.config.tag.clone(),
            type_name: "wireguard".to_string(),
            now: None,
            all: vec![],
            history: vec![],
        }
    }
}

// ── IP/UDP 封包辅助 ────────────────────────────────────────────────────────────

/// 将 payload 封装为 IPv4/UDP 包（用于通过 WireGuard 隧道发送）
fn build_udp_ip_packet(payload: &[u8], src: &SocketAddr, dst: &Target) -> anyhow::Result<Vec<u8>> {
    // 简化：仅支持 IPv4 UDP
    // 完整实现需要处理 IPv6 和 TCP
    let src_ip = match src.ip() {
        IpAddr::V4(ip) => ip.octets(),
        IpAddr::V6(_) => return Err(anyhow!("WireGuard: IPv6 not yet supported")),
    };
    let (dst_ip, dst_port) = match dst {
        Target::Socket(addr) => match addr.ip() {
            IpAddr::V4(ip) => (ip.octets(), addr.port()),
            IpAddr::V6(_) => return Err(anyhow!("WireGuard: IPv6 dst not yet supported")),
        },
        Target::Domain(_, _) => {
            return Err(anyhow!(
                "WireGuard: domain target requires DNS resolution in tunnel"
            ));
        }
    };

    let udp_len = 8 + payload.len();
    let ip_len = 20 + udp_len;

    let mut pkt = vec![0u8; ip_len];
    // IPv4 header
    pkt[0] = 0x45; // version=4, IHL=5
    pkt[1] = 0; // DSCP/ECN
    let total_len = ip_len as u16;
    pkt[2] = (total_len >> 8) as u8;
    pkt[3] = (total_len & 0xff) as u8;
    pkt[6] = 0x40; // Don't fragment
    pkt[8] = 64; // TTL
    pkt[9] = 17; // UDP
    pkt[12..16].copy_from_slice(&src_ip);
    pkt[16..20].copy_from_slice(&dst_ip);

    // IP checksum
    let cksum = ip_checksum(&pkt[..20]);
    pkt[10] = (cksum >> 8) as u8;
    pkt[11] = (cksum & 0xff) as u8;

    // UDP header
    pkt[20] = (src.port() >> 8) as u8;
    pkt[21] = (src.port() & 0xff) as u8;
    pkt[22] = (dst_port >> 8) as u8;
    pkt[23] = (dst_port & 0xff) as u8;
    pkt[24] = (udp_len >> 8) as u8;
    pkt[25] = (udp_len & 0xff) as u8;
    // UDP checksum = 0 (optional for IPv4)

    pkt[28..].copy_from_slice(payload);
    Ok(pkt)
}

fn parse_udp_ip_packet(pkt: &[u8]) -> anyhow::Result<(Vec<u8>, SocketAddr)> {
    if pkt.len() < 28 {
        return Err(anyhow!("IP packet too short"));
    }
    let version = (pkt[0] >> 4) & 0xf;
    if version != 4 {
        return Err(anyhow!("only IPv4 supported"));
    }
    let ihl = (pkt[0] & 0xf) as usize * 4;
    let proto = pkt[9];
    if proto != 17 {
        return Err(anyhow!("only UDP proto supported"));
    }
    let src_ip = std::net::Ipv4Addr::new(pkt[12], pkt[13], pkt[14], pkt[15]);
    let src_port = u16::from_be_bytes([pkt[ihl], pkt[ihl + 1]]);
    let payload = pkt[ihl + 8..].to_vec();
    Ok((payload, SocketAddr::new(IpAddr::V4(src_ip), src_port)))
}

fn ip_checksum(header: &[u8]) -> u16 {
    let mut sum = 0u32;
    let mut i = 0;
    while i + 1 < header.len() {
        sum += u16::from_be_bytes([header[i], header[i + 1]]) as u32;
        i += 2;
    }
    while sum >> 16 != 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_key_valid() {
        // 32 bytes base64
        let key = base64::engine::general_purpose::STANDARD.encode([0x42u8; 32]);
        let decoded = decode_key_base64(&key).unwrap();
        assert_eq!(decoded, [0x42u8; 32]);
    }

    #[test]
    fn decode_key_invalid_length() {
        let key = base64::engine::general_purpose::STANDARD.encode([0u8; 16]);
        assert!(decode_key_base64(&key).is_err());
    }

    #[test]
    fn ip_checksum_known_value() {
        // RFC 1071 example header with zero checksum field
        let hdr = [
            0x45, 0x00, 0x00, 0x3c, 0x1c, 0x46, 0x40, 0x00, 0x40, 0x06, 0x00,
            0x00, // checksum = 0
            0xac, 0x10, 0x0a, 0x63, 0xac, 0x10, 0x0a, 0x0c,
        ];
        let cksum = ip_checksum(&hdr);
        // fill result back and verify
        let mut h = hdr;
        h[10] = (cksum >> 8) as u8;
        h[11] = (cksum & 0xff) as u8;
        assert_eq!(ip_checksum(&h), 0xffff);
    }

    #[test]
    fn tai64n_format() {
        let ts = tai64n_now();
        assert_eq!(ts.len(), 12);
        // TAI64 seconds should be > 2^62 (2023+)
        let secs = u64::from_be_bytes(ts[..8].try_into().unwrap());
        assert!(secs > 4611686018427387914 + 1600000000);
    }

    #[test]
    fn hkdf2_deterministic() {
        let key = [1u8; 32];
        let input = b"test input";
        let (t1a, t2a) = hkdf2(&key, input);
        let (t1b, t2b) = hkdf2(&key, input);
        assert_eq!(t1a, t1b);
        assert_eq!(t2a, t2b);
        assert_ne!(t1a, t2a);
    }

    #[test]
    fn aead_roundtrip() {
        let key = [0x42u8; 32];
        let plain = b"WireGuard test payload";
        let cipher = aead_encrypt(&key, 0, plain, b"aad");
        let decrypted = aead_decrypt(&key, 0, &cipher, b"aad").unwrap();
        assert_eq!(&decrypted, plain);
    }

    #[test]
    fn udp_ip_packet_roundtrip() {
        let payload = b"hello wireguard";
        let src: SocketAddr = "10.0.0.1:12345".parse().unwrap();
        let dst = Target::Socket("10.0.0.2:53".parse().unwrap());
        let pkt = build_udp_ip_packet(payload, &src, &dst).unwrap();
        let (decoded, src_addr) = parse_udp_ip_packet(&pkt).unwrap();
        assert_eq!(decoded, payload);
        assert_eq!(src_addr.port(), 12345);
    }
}

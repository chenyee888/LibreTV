import {
  createCipheriv, createDecipheriv, createECDH, createHmac, publicEncrypt, randomBytes,
  constants as cryptoConstants,
} from 'node:crypto';
import { deflateSync, inflateSync, deflateRawSync, inflateRawSync } from 'node:zlib';
import type { SearchResultItem, SourceConfig, VideoDetail } from './types';
import { checkUpstreamAllowed } from './ssrf';

type Field = { no: number; wire: number; value: bigint | Buffer };

function varint(n: bigint): Buffer {
  const out: number[] = [];
  let v = n;
  while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; }
  out.push(Number(v));
  return Buffer.from(out);
}
function tag(no: number, wire: number): Buffer { return varint(BigInt((no << 3) | wire)); }
function pbBytes(no: number, value: Buffer | string): Buffer {
  const b = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([tag(no, 2), varint(BigInt(b.length)), b]);
}
function pbVar(no: number, value: number | bigint): Buffer { return Buffer.concat([tag(no, 0), varint(BigInt(value))]); }
function pbDecode(buf: Buffer): Field[] {
  const out: Field[] = []; let p = 0;
  const read = (): bigint => {
    let n = 0n; let shift = 0n;
    while (p < buf.length) {
      const b = buf[p++]; n |= BigInt(b & 127) << shift;
      if (!(b & 128)) return n;
      shift += 7n; if (shift > 70n) throw new Error('protobuf varint overflow');
    }
    throw new Error('truncated protobuf');
  };
  while (p < buf.length) {
    const t = Number(read()); const no = t >>> 3; const wire = t & 7;
    if (!no) throw new Error('invalid protobuf field');
    if (wire === 0) out.push({ no, wire, value: read() });
    else if (wire === 2) {
      const len = Number(read()); if (len < 0 || p + len > buf.length) throw new Error('truncated protobuf bytes');
      out.push({ no, wire, value: buf.subarray(p, p + len) }); p += len;
    } else if (wire === 1) { if (p + 8 > buf.length) throw new Error('truncated protobuf fixed64'); p += 8; }
    else if (wire === 5) { if (p + 4 > buf.length) throw new Error('truncated protobuf fixed32'); p += 4; }
    else throw new Error('unsupported protobuf wire type');
  }
  return out;
}
function bytes(f: Field | undefined): Buffer { return f && Buffer.isBuffer(f.value) ? f.value : Buffer.alloc(0); }
function str(f: Field | undefined): string { return bytes(f).toString('utf8'); }
function num(f: Field | undefined): number { return f && typeof f.value === 'bigint' ? Number(f.value) : 0; }
function fields(buf: Buffer, no: number): Field[] { return pbDecode(buf).filter(f => f.no === no); }
function first(buf: Buffer, no: number): Field | undefined { return fields(buf, no)[0]; }
function apiData(buf: Buffer): Buffer {
  const f = first(buf, 3);
  if (!f) throw new Error('上游响应缺少 protobuf data 字段');
  return bytes(f);
}
function javaHashIndex(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return (h ^ (h >>> 16)) & 15;
}
function randText(size: number): string {
  const alphabet = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const b = randomBytes(size - 1);
  return Array.from(b, x => alphabet[x % alphabet.length]).join('') + '=';
}
function aesEncrypt(data: Buffer, key: string, mode: 'ecb' | 'cbc', iv?: Buffer): Buffer {
  const algorithm = mode === 'ecb' ? `aes-${key.length * 8}-ecb` : `aes-${key.length * 8}-cbc`;
  const cipher = createCipheriv(algorithm, Buffer.from(key), mode === 'ecb' ? null : (iv || Buffer.alloc(16)));
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
function aesDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const d = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  return Buffer.concat([d.update(data), d.final()]);
}
function rsaEncrypt(text: string, publicKeyB64: string): string {
  const der = Buffer.from(publicKeyB64, 'base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
  return publicEncrypt({ key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(text)).toString('base64');
}
async function postBytes(url: string, body: Buffer, headers: Record<string, string>, contentType = 'application/x-protobuf'): Promise<Buffer> {
  const res = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': contentType }, body: new Uint8Array(body), signal: AbortSignal.timeout(18000) });
  if (!res.ok) throw new Error(`上游 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
function toProxyUrl(url: string, headers: Record<string, string>): string {
  const token = Buffer.from(JSON.stringify(headers)).toString('base64url');
  return `/api/proxy?headers=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}`;
}
async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`上游 HTTP ${res.status}`);
  return res.text();
}

interface AppDramaConfig {
  appName: string; publicKey: string; dataKey: string; dataIv: string; pkg: string;
  host?: string; site?: string; version: string; decrypt?: string;
}
function getAppConfig(source: SourceConfig): AppDramaConfig {
  const c = (source.ext || {}) as Partial<AppDramaConfig>;
  if (!c.publicKey || !c.dataKey || !c.dataIv || !c.pkg || !c.appName || !c.version) throw new Error('橘汁源配置不完整');
  return c as AppDramaConfig;
}
class AppDramaClient {
  private host = '';
  private dynamicKey = '';
  private readonly staticKey = 'ed5fdsgucxumegqa';
  private constructor(private cfg: AppDramaConfig) {}
  static async create(source: SourceConfig): Promise<AppDramaClient> {
    const client = new AppDramaClient(getAppConfig(source));
    client.host = client.cfg.host || '';
    if (client.cfg.site) {
      try {
        const remote = JSON.parse(await getText(client.cfg.site));
        if (typeof remote.domain === 'string' && remote.domain) client.host = remote.domain.replace(/\/$/, '');
      } catch { /* keep configured host if the remote config is temporarily unavailable */ }
    }
    if (!client.host) throw new Error('橘汁远程配置未返回 domain，暂时无法连接');
    if (!/^https?:\/\//.test(client.host)) client.host = `https://${client.host}`;
    const verdict = await checkUpstreamAllowed(client.host);
    if (!verdict.ok) throw new Error(`橘汁上游地址不可用：${verdict.reason}`);
    const timestamp = Date.now(); const random = randText(16);
    const request = Buffer.concat([
      pbVar(1, timestamp), pbBytes(2, rsaEncrypt(`${timestamp}${random}`, client.cfg.publicKey)),
      pbBytes(3, randText(16)), pbBytes(4, random), pbBytes(5, randText(16)),
    ]);
    const headers = await client.publicHeaders();
    const response = apiData(await postBytes(`${client.host}/api/v5/find/app/zone`, request, headers));
    const values = pbDecode(response);
    client.dynamicKey = [2, 3, 4, 5].map(n => str(values.find(f => f.no === n))).join('');
    return client;
  }
  private device(): Record<string, string | number> {
    const uuid = randomBytes(16).toString('hex').toUpperCase();
    return {
      country: 'CN', vName: this.cfg.version, cpuId: 'MT6893Z%2FCZA', young: 0,
      facturer: 'Google', pkg: this.cfg.pkg, uuid, resolution: '1080x2272',
      mac: '02%3A00%3A00%3A00%3A00%3A00', abid: '397', model: 'Pixel 4',
      plat: 'android', udid: uuid, dpi: '440', net: '1', lang: 'zh', brand: 'Google',
      cpu: 'arm64-v8a', chid: '10000', carrier: '%E8%81%94%E9%80%9A', _vOsCode: 30,
      vOs: '11', v: 1, tenantId: '', vApp: this.cfg.version.replace(/\./g, ''), device: 0,
      androidID: uuid.slice(0, 16),
    };
  }
  private async publicHeaders(): Promise<Record<string, string>> {
    const device = this.device(); const timestamp = Date.now(); const random = randText(16);
    const publicKey = this.dynamicKey || this.cfg.publicKey;
    const sig = rsaEncrypt(`${timestamp}${random}${device.vApp}`, publicKey);
    const sig2 = aesEncrypt(Buffer.from(`${timestamp}${random}`), this.cfg.dataIv, 'ecb').toString('base64');
    const params = { ...device, sig, random_str: random, timestamp, sig2: sig2.slice(0, 8), sig3: sig2.slice(8) };
    const encrypted = aesEncrypt(Buffer.from(JSON.stringify(params)), this.staticKey, 'cbc', Buffer.from(this.staticKey)).toString('hex');
    return {
      'User-Agent': 'okhttp/3.12.1', Accept: 'application/x-protobuf',
      publicParams: JSON.stringify({ paramsData: encrypted }),
    };
  }
  private requestBody(params: Record<string, string>): Buffer {
    const timestamp = Date.now(); const random = randText(8); const fake = randText(20);
    const query = Object.entries(params).filter(([,v]) => v !== '').sort((a,b) => javaHashIndex(a[0]) - javaHashIndex(b[0])).map(([k,v]) => `${k}=${v}`).join('&');
    const encrypted = aesEncrypt(Buffer.from(query + timestamp), this.cfg.dataKey, 'ecb').toString('base64');
    const packed = random + encrypted;
    return Buffer.concat([
      pbBytes(1, packed.slice(0, 20)), pbBytes(2, packed.slice(20)),
      pbBytes(3, fake), pbVar(4, timestamp), pbBytes(5, random),
    ]);
  }
  async api(path: string, params: Record<string, string>): Promise<Buffer> {
    const headers = await this.publicHeaders();
    const body = this.requestBody(params);
    return apiData(await postBytes(`${this.host}${path}`, body, headers));
  }
  async search(keyword: string, page: number): Promise<SearchResultItem[]> {
    const data = await this.api('/api/proto/v5/drama/search', { searchKeys: keyword, page: String(page), pagesize: '21' });
    const pageFields = pbDecode(data);
    return pageFields.filter(f => f.no === 1).map(f => {
      const b = bytes(f);
      const cover = bytes(first(b, 2)?.value && typeof first(b, 2)?.value !== 'bigint' ? first(b, 2) : undefined);
      return {
        sourceKey: '', sourceName: '', vodId: String(num(first(b, 3))),
        name: str(first(b, 5)), pic: str(first(cover, 2)), remarks: str(first(b, 13)),
        typeName: str(first(b, 9)), year: String(num(first(b, 14)) || ''),
      };
    }).filter(x => x.vodId && x.name);
  }
  async resolvePlay(encoded: string): Promise<{ url: string; headers?: Record<string,string> }> {
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string,string>;
    const data = await this.api('/api/proto/v5/videoUsableUrl', payload);
    const url = str(first(data, 1));
    const headers: Record<string,string> = {};
    for (const entry of fields(data, 6)) {
      const map = pbDecode(bytes(entry));
      headers[str(map.find(f => f.no === 1))] = str(map.find(f => f.no === 2));
    }
    if (!url) throw new Error('橘汁没有返回可播放地址');
    return { url, headers };
  }
  async detail(id: string): Promise<VideoDetail> {
    const data = await this.api('/api/proto/v5/drama/getDetail', { id });
    const info = {
      title: str(first(data, 9)), cover: str(first(bytes(first(data, 2)), 2)),
      desc: str(first(data, 6)), typeName: str(first(data, 15)),
      year: String(num(first(data, 18)) || ''), area: str(first(data, 1)),
      director: str(first(data, 12)), actor: str(first(data, 25)), remarks: str(first(data, 26)),
    };
    const groups = new Map<string, string[]>();
    const videos = fields(data, 29);
    for (const vf of videos) {
      const video = bytes(vf);
      const source = str(first(video, 10)) || '橘汁';
      const path = str(first(video, 4));
      if (!path) continue;
      let playUrl = path;
      if (!/\.(mp4|m3u8|flv|mkv|avi|ts|mov|mpd|m4a|wmv)(\?.*)?$/i.test(path)) {
        const token = Buffer.from(JSON.stringify({ vodPlayFrom: str(first(video, 9)), playUrl: path })).toString('base64');
        try {
          const resolved = await this.resolvePlay(token);
          playUrl = resolved.url;
          if (resolved.headers && Object.keys(resolved.headers).length) {
            playUrl = toProxyUrl(playUrl, resolved.headers);
          }
        } catch { continue; }
      }
      const list = groups.get(source) || []; list.push(playUrl); groups.set(source, list);
    }
    const from = Array.from(groups.keys()); const urls = Array.from(groups.values()).map(x => x.join('#'));
    if (!from.length) throw new Error('橘汁详情中没有可用播放线路');
    return { videoInfo: { ...info, sourceKey: '', sourceName: '' }, episodes: urls.flatMap(x => x.split('#')) };
  }
}

function upgradeGuluQuality(url: string): string {
  if (!url.includes('.m3u8')) return url;
  return url.replace(/\/\d{3,4}k[bB]?\//, '/2000k/').replace(/index_\d+k/, 'index_2000k').replace(/\/720[pP]\//, '/1080p/');
}

const GULU_GATEWAY = 'http://103.45.132.22:19987/app/bn/v2';
class GuluClient {
  private session = ''; private key = Buffer.alloc(0); private templates: Record<string,string> = {}; private deviceId = randomBytes(8).toString('hex');
  private constructor() {}
  static async create(): Promise<GuluClient> {
    const c = new GuluClient(); await c.handshake(); await c.boot(); return c;
  }
  private async handshake(): Promise<void> {
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const pub = ecdh.getPublicKey(undefined, 'uncompressed');
    const key = randomBytes(16).toString('hex'); const iv = randomBytes(16);
    const init = Buffer.concat([pbBytes(1, pub), pbBytes(2, '1.0.0'), pbBytes(3, Buffer.concat([pbVar(1,1),pbVar(2,1),pbVar(3,1)]))]);
    const encrypted = aesEncrypt(deflateSync(init, { level: 5 }), key, 'cbc', iv);
    const body = Buffer.concat([iv, encrypted]).toString('base64');
    const res = await fetch(GULU_GATEWAY, { method:'POST', headers:{
      'Content-Type':'text/plain','User-Agent':'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4)',
      'X-Player-Page-Protection':'1','X-Handshake-Key':key,
    }, body, signal:AbortSignal.timeout(18000) });
    if (!res.ok) throw new Error(`咕噜握手 HTTP ${res.status}`);
    const raw = Buffer.from((await res.text()).trim(),'base64');
    const plain = inflateSync(aesDecrypt(raw.subarray(16), Buffer.from(key), raw.subarray(0,16)));
    const f = pbDecode(plain); this.session = str(f.find(x=>x.no===1)); const server = bytes(f.find(x=>x.no===2));
    if (!this.session || server.length !== 65) throw new Error('咕噜握手响应格式不正确');
    const secret = ecdh.computeSecret(server).subarray(-32);
    const firstMac = createHmac('sha256', Buffer.from(this.session)).update(secret).digest();
    this.key = createHmac('sha256', firstMac).update(Buffer.from([118,50,45,115,101,115,115,105,111,110,1])).digest();
  }
  private async call(group: number, action: number, payload: Buffer): Promise<Buffer> {
    const timestamp = Date.now();
    const inner = Buffer.concat([pbVar(1,timestamp),pbVar(2,group),pbVar(3,action),pbBytes(4,this.deviceId),pbBytes(5,Buffer.alloc(0)),pbBytes(6,payload),pbVar(7,timestamp)]);
    const compressed = deflateRawSync(inner,{level:6});
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',this.key,iv);
    const encrypted = Buffer.concat([cipher.update(compressed),cipher.final(),cipher.getAuthTag()]);
    const blob = Buffer.concat([iv,encrypted]);
    const body = Buffer.concat([pbVar(1,timestamp),pbBytes(2,blob)]);
    const res = await fetch(GULU_GATEWAY,{method:'POST',headers:{
      'Content-Type':'application/x-protobuf','User-Agent':'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4)',
      'X-Player-Page-Protection':'1','X-Session-Id':this.session,
    },body:new Uint8Array(body),signal:AbortSignal.timeout(18000)});
    if(!res.ok) throw new Error(`咕噜接口 HTTP ${res.status}`);
    const outer = pbDecode(Buffer.from(await res.arrayBuffer()));
    const encryptedResponse = bytes(outer.find(x=>x.no===2));
    if(encryptedResponse.length<28) throw new Error('咕噜响应缺少密文');
    const nonce=encryptedResponse.subarray(0,12), tagBytes=encryptedResponse.subarray(-16), data=encryptedResponse.subarray(12,-16);
    const decipher=createDecipheriv('aes-256-gcm',this.key,nonce);decipher.setAuthTag(tagBytes);
    const decoded=inflateRawSync(Buffer.concat([decipher.update(data),decipher.final()]));
    return bytes(pbDecode(decoded).find(x=>x.no===4));
  }
  private async boot(): Promise<void> {
    const app=Buffer.concat([pbBytes(1,'咕噜咕噜'),pbBytes(2,'2.1.2'),pbBytes(3,'com.jymqfh.xee'),pbBytes(4,this.deviceId),pbBytes(5,'212')]);
    const device=Buffer.concat([pbBytes(1,this.deviceId),pbVar(2,0),pbBytes(3,'11'),pbBytes(4,'Pixel 4'),pbBytes(5,'google/redfin/redfin:11/RQ3A.211001.001'),pbBytes(6,'google'),pbBytes(7,'redfin'),pbVar(8,0),pbBytes(9,'unknown'),pbBytes(10,'unknown'),pbVar(11,0),pbVar(12,30)]);
    const payload=Buffer.concat([pbBytes(1,'v1'),pbBytes(2,'Android 11'),pbBytes(3,'gulu'),pbBytes(4,app),pbBytes(5,device)]);
    const data=await this.call(1,0,payload);
    for(const item of fields(data,7)){const x=pbDecode(bytes(item));const name=str(x.find(y=>y.no===2));const url=str(x.find(y=>y.no===3));if(name&&url)this.templates[name]=url;}
  }
  async search(keyword:string,page:number):Promise<SearchResultItem[]>{
    const sort=Buffer.concat([pbVar(1,1),pbVar(2,0),pbBytes(3,'vod_hits_week')]);
    const payload=Buffer.concat([pbBytes(1,keyword),pbVar(2,page),pbBytes(5,sort)]);
    const data=await this.call(3,61,payload);
    return this.parseList(data);
  }
  private parseList(data:Buffer):SearchResultItem[]{
    const out:SearchResultItem[]=[];
    const parseOne=(b:Buffer)=>{
      const fs=pbDecode(b);const id=String(num(fs.find(x=>x.no===1)));const name=str(fs.find(x=>x.no===3));
      if(id&&name)out.push({sourceKey:'',sourceName:'',vodId:id,name,pic:str(fs.find(x=>x.no===6)),remarks:str(fs.find(x=>x.no===11))||str(fs.find(x=>x.no===9)),typeName:str(fs.find(x=>x.no===9))});
    };
    for(const f of data.length?pbDecode(data):[]){if(f.wire!==2)continue;const b=bytes(f);const nested=pbDecode(b);const items=nested.filter(x=>x.no===66&&x.wire===2);if(items.length){for(const item of items)parseOne(bytes(item));}else if(nested.some(x=>x.no===2&&x.wire===0))parseOne(b);else for(const item of nested.filter(x=>x.no===3&&x.wire===2))parseOne(bytes(item));}
    return out.slice(0,100);
  }
  async detail(id:string):Promise<VideoDetail>{
    const data=await this.call(3,62,Buffer.concat([pbVar(1,BigInt(id)),pbBytes(4,'APP_PLATFORM_ANDROID_TV'),pbVar(5,0)]));
    const fs=pbDecode(data);const title=str(fs.find(x=>x.no===5));const groups=new Map<string,string[]>();
    for(const group of fields(data,75)){
      const g=pbDecode(bytes(group));const source=str(g.find(x=>x.no===1))||'咕噜';
      for (const ep of g.filter(x => x.no === 2 && x.wire === 2)) {
        const e = pbDecode(bytes(ep));
        let url = str(e.find(x => x.no === 3));
        if (!url) continue;
        if (/^https?:\/\//i.test(url)) {
          url = upgradeGuluQuality(url);
        } else {
          const prefix = Object.keys(this.templates).find(k => url.startsWith(k));
          if (!prefix) continue;
          try {
            let token = url;
            if ((token.startsWith('CO4K_') || token.startsWith('rose_')) && token.includes('*') && !token.includes('%2B')) {
              token = token.replace(' ', '*');
            }
            const encoded = encodeURIComponent(token).replace(/%20/g, '+').replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%5F/gi, '_').replace(/%2D/gi, '-');
            const parseUrl = this.templates[prefix] + encoded;
            const verdict = await checkUpstreamAllowed(parseUrl);
            if (!verdict.ok) throw new Error(verdict.reason);
            const text = await getText(parseUrl, { 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4)' });
            url = JSON.parse(text).url || text.match(/"url"\s*:\s*"([^"]+)"/)?.[1] || '';
            if (url) url = upgradeGuluQuality(url);
          } catch { url = ''; }
        }
        if (url) {
          const list = groups.get(source) || [];
          list.push(toProxyUrl(url, { 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4)' }));
          groups.set(source, list);
        }
      }
    }
    const episodes=Array.from(groups.values()).flatMap(v=>v);
    if(!episodes.length)throw new Error('咕噜详情没有解析出可播放剧集');
    return {videoInfo:{title,sourceKey:'',sourceName:''},episodes};
  }
}

export async function spiderSearch(source:SourceConfig,keyword:string,page=1):Promise<SearchResultItem[]>{
  const list=source.adapter==='gulu'?await (await GuluClient.create()).search(keyword,page):await (await AppDramaClient.create(source)).search(keyword,page);
  return list.map(item=>({...item,sourceKey:source.key,sourceName:source.name,sourceUrl:source.url}));
}
export async function spiderDetail(source:SourceConfig,id:string):Promise<VideoDetail>{
  const detail=source.adapter==='gulu'?await (await GuluClient.create()).detail(id):await (await AppDramaClient.create(source)).detail(id);
  detail.videoInfo.sourceKey=source.key;detail.videoInfo.sourceName=source.name;detail.videoInfo.sourceUrl=source.url;
  return detail;
}

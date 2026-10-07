#!/usr/bin/env python3
"""抓取 r/orclStock 与 r/TQQQ 两个版的最新帖，写入项目根目录 reddit_posts.json。

抓什么（2026-10-07 用户定稿）
----------------------------
只要这两个版面，别的都不要 —— 版本身就是筛选：
    ORCL → r/orclStock
    TQQQ → r/TQQQ
用 oanor 的 `/v1/subreddit/posts`（`sort=new&limit=100`）直接拉版内最新帖，
**不做任何关键词/标题过滤**：既然版已经选对了，帖子自然就在聊这只票
（早期版本用全站 `search/posts?query=ORCL`，只要帖子里出现三个字母就进来，
于是热力图、大盘综述、营销号 spam 全涌进面板 —— 实测 ORCL 23 条里只有 2 条相关）。

每次运行**整份覆盖** `reddit_posts.json`：文件只有一份、每次全量替换，
前端读到的永远是最后一次抓的那版，无需比较 updated（前端会给 url 加时间戳破缓存）。

为什么走 GitHub Actions 而不是前端直连
-------------------------------------
oanor 的 reddit-api **不给 CORS 头**（实测：带 Origin 的 GET 响应里没有
Access-Control-Allow-Origin；而 `x-oanor-key` 是自定义头会触发 OPTIONS 预检，
预检不带 key → 401）。所以浏览器无论如何都拿不到响应，只能沿用本仓库既有套路：
    Actions 定时抓 → 落成 JSON → 前端读同目录静态文件
key 放在仓库 Secrets（`OANOR_KEY`）里，不进前端、不进仓库。

额度账（官方 500 次/月）
----------------------
一次运行 = 2 次调用（两个版各一次），挂进现有两个 workflow（各跑一次）
→ 4 次/天 ≈ 120 次/月，留了 75% 余量。
⚠️ limit 拉满 100 **不额外扣额度**（按调用次数计），所以每个版一次拿满最划算。

为什么**不抓**评论正文
--------------------
评论要按帖逐个请求 `/post/comments`，1 帖 1 次调用 —— 抓 5 帖就是 5 次，
一天两轮直接烧穿月度额度。当前只保存帖子自带的评论数等元信息。

用法
----
    OANOR_KEY=xxx python fetch_reddit.py            # 抓默认两个版
    OANOR_KEY=xxx python fetch_reddit.py --tickers ORCL        # 只抓其中一个
    python fetch_reddit.py --filter-only           # 不联网，只把已有 json 重排/截断一遍
    OANOR_KEY=xxx python fetch_reddit.py -o reddit_posts.json
"""
import argparse
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = 'https://api.oanor.com/reddit-api/v1/subreddit/posts'

# 标的 → 抓哪个版（2026-10-07 用户定稿：只要 orclStock 和 TQQQ 两个版面）
DEFAULT_TARGETS = {
    'ORCL': 'orclStock',
    'TQQQ': 'TQQQ',
}
LIMIT = 100                             # 单页上限：实测 limit=250 也只返回 100 条
# 正文不再截断（用户 2026-10-07：「不应该限制讨论的字数和高度」）。
# 原先按 240 字符截，列表里读到的 Reddit 正文一律半截（实测有正文被砍在 "…inspir" 处）。
# 面板本身是纵向滚动的，长文自然往下延伸即可；这里只防一个极端情况：
# 十万字级的灌水帖把 json 撑爆，超过上限就保留前 8000 字（远大于正常帖子长度）。
SELFTEXT_MAX = 8000
TIMEOUT = 45
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reddit_posts.json')


def build_url(sub):
    return API + '?' + urllib.parse.urlencode(
        {'subreddit': sub, 'sort': 'new', 'limit': LIMIT})


def fetch(sub, key):
    """先试 curl（本机有 HTTPS 拦截，Python 校验会失败、curl 走系统证书链能过），
    curl 不可用再退回 urllib 并关校验。key 只进请求头，绝不落盘、绝不打印。"""
    url = build_url(sub)
    req = urllib.request.Request(url, headers={
        'x-oanor-key': key,
        'User-Agent': 'curl/8',
        'Accept': 'application/json',
    })
    try:
        raw = subprocess.run(
            ['curl', '-sS', '--max-time', str(TIMEOUT), '-H', 'x-oanor-key: ' + key, url],
            capture_output=True, timeout=TIMEOUT + 5)
        if raw.returncode == 0 and raw.stdout.strip():
            return json.loads(raw.stdout.decode('utf-8'))
    except Exception:                                        # noqa: BLE001
        pass
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
        return json.loads(r.read().decode('utf-8'))


def norm(ticker, posts, sub=None):
    """统一字段 → 前端只依赖这些键。缺字段一律给安全默认值。
    唯一的加工是「限定在配置的版 + 按时间严格倒序 + 截断到 limit」——
    版已经选对了，不再做任何关键词/标题过滤。
    ⚠️ sub 形参不能省：正式抓取时接口本来就只返回该版，但 --filter-only 走的是旧文件，
       里面可能混着别的版（早期版本是全站搜索），不裁一刀就会把噪音带回来。"""
    out = []
    seen = set()
    want = (sub or '').lower()
    for p in (posts or []):
        pid = str(p.get('id') or p.get('permalink') or '')
        if not pid or pid in seen:
            continue
        cur = str(p.get('subreddit') or '').lower()
        if want and cur != want:
            continue
        seen.add(pid)
        body = (p.get('selftext') or '').strip()
        out.append({
            'id': pid,
            'title': (p.get('title') or '').strip(),
            'subreddit': p.get('subreddit') or '',
            'author': p.get('author') or '',
            'created_utc': int(p.get('created_utc') or 0),
            'score': p.get('score') or 0,
            'num_comments': p.get('num_comments') or 0,
            'url': p.get('url') or '',
            'permalink': p.get('permalink') or '',
            'selftext': body[:SELFTEXT_MAX],
        })
    # sort=new 本就倒序，这里再排一次保证严格有序（不依赖接口返回顺序）
    out.sort(key=lambda x: x['created_utc'], reverse=True)
    return {'ticker': ticker, 'count': len(out[:LIMIT]), 'posts': out[:LIMIT]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tickers', default=','.join(DEFAULT_TARGETS),
                    help='要抓的标的代码，逗号分隔（取 DEFAULT_TARGETS 里配好的版）')
    ap.add_argument('-o', '--output', default=OUT, help='输出 JSON 路径')
    ap.add_argument('--filter-only', action='store_true',
                    help='不联网，只把已有 json 重排/截断一遍（改规则后不必等定时任务）')
    args = ap.parse_args()

    # ---- 只处理已有文件（不联网）----
    if args.filter_only:
        if not os.path.exists(args.output):
            print('[reddit] %s 不存在，没什么可处理' % args.output, file=sys.stderr)
            return 1
        with open(args.output, encoding='utf-8') as f:
            doc = json.load(f)
        for tk, rec in (doc.get('tickers') or {}).items():
            doc['tickers'][tk] = norm(tk, rec.get('posts') or [], DEFAULT_TARGETS.get(tk))
            if DEFAULT_TARGETS.get(tk):
                doc['tickers'][tk]['subreddit'] = DEFAULT_TARGETS[tk]
        # 元信息也一并对齐，免得这条路径产出的文件缺 subs/updated（前端与排查都靠它）
        doc['subs'] = {t: DEFAULT_TARGETS[t] for t in (doc.get('tickers') or {})
                       if DEFAULT_TARGETS.get(t)}
        doc['updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        doc['source'] = ('oanor reddit-api（/v1/subreddit/posts，sort=new，r/orclStock + r/TQQQ）')
        doc['note'] = '只抓两个版的帖子列表，不含评论正文（评论按帖单独计费）'
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False)
            f.write('\n')
        print('[reddit] 已重排 %s：%s' % (args.output, '、'.join(
            '%s %d 条' % (k, v['count']) for k, v in doc['tickers'].items())))
        return 0

    key = os.environ.get('OANOR_KEY', '').strip()
    if not key:
        print('[reddit] 未设置环境变量 OANOR_KEY —— '
              '请在仓库 Settings → Secrets 里添加后再跑', file=sys.stderr)
        return 1

    tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
    result, failed = {}, []
    for i, t in enumerate(tickers):
        sub = DEFAULT_TARGETS.get(t)
        if not sub:
            print('[reddit] %s 不在 DEFAULT_TARGETS 里，跳过（要抓请先加版配置）' % t,
                  file=sys.stderr)
            continue
        if i:
            time.sleep(3)      # 短窗口有约 3 次/十几秒的突发限制，串行时留点空隙
        try:
            j = fetch(sub, key)
        except Exception as e:                              # noqa: BLE001
            failed.append('%s: %s' % (sub, e))
            continue
        if not (j or {}).get('success'):
            failed.append('%s: %s' % (sub, (j or {}).get('message') or '接口返回失败'))
            continue
        posts = ((j or {}).get('data') or {}).get('posts') or []
        result[t] = norm(t, posts, sub)
        result[t]['subreddit'] = sub
        print('[reddit] r/%s：%d 条' % (sub, result[t]['count']))

    if not result:
        # 一个都没抓到：保留上一版文件（工作流里这一天就没数据，但不会把页面搞空）
        print('[reddit] 本次全部失败（%s），不覆盖已有文件 %s'
              % ('; '.join(failed) or '未知原因', args.output), file=sys.stderr)
        return 0

    out = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'oanor reddit-api（/v1/subreddit/posts，sort=new，r/orclStock + r/TQQQ）',
        'note': '只抓两个版的帖子列表，不含评论正文（评论按帖单独计费）',
        'subs': {t: DEFAULT_TARGETS[t] for t in result},
        'tickers': result,
    }
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
        f.write('\n')
    print('[reddit] 已覆盖写入 %s：%s' % (args.output, '、'.join(
        '%s %d 条' % (k, v['count']) for k, v in result.items())))
    if failed:
        print('[reddit] 部分失败：%s' % '; '.join(failed), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
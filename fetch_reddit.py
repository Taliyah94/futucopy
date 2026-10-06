#!/usr/bin/env python3
"""抓取 Reddit 上与持仓相关的帖子（默认 ORCL / TQQQ），写入项目根 reddit_posts.json。

为什么走 GitHub Actions 而不是前端直连
-------------------------------------
oanor 的 reddit-api **不给 CORS 头**（实测：带 Origin 的 GET 响应里没有
Access-Control-Allow-Origin；而 `x-oanor-key` 是自定义头会触发 OPTIONS 预检，
预检不带 key → 401）。所以浏览器无论如何都拿不到响应，只能沿用本仓库既有套路：
    Actions 定时抓 → 落成 JSON → 前端读同目录静态文件
顺带把 key 放在仓库 Secrets（`OANOR_KEY`）里，不进前端、不进仓库。

额度账（官方 500 次/月）
----------------------
本脚本每跑一次 = 2 次调用（ORCL、TQQQ 各一次，一次最多拿 100 条）。
挂进现有两个 workflow（各跑一次）→ 4 次/天 ≈ 120 次/月，留了 75% 余量。
⚠️ limit 从 3 调到 100 **不额外扣额度**（按调用次数计），所以每票一次拿满最划算。

为什么**不抓**评论正文
--------------------
评论要按帖逐个请求 `/post/comments`，1 帖 1 次调用 —— 抓 5 帖就是 5 次，
一天两轮直接烧穿月度额度。当前只保存帖子自带的评论数等元信息。

用法
----
    OANOR_KEY=xxx python fetch_reddit.py            # 抓默认两个票
    OANOR_KEY=xxx python fetch_reddit.py --tickers ORCL,NVDA
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

API = 'https://api.oanor.com/reddit-api/v1/search/posts'
DEFAULT_TICKERS = ['ORCL', 'TQQQ']      # 持仓相关的两只（用户 2026-10-07 定稿）
LIMIT = 100                             # 单页上限：实测 limit=250 也只返回 100 条
KEEP = 80                               # 每票最多保留多少条（控制文件体积）
SELFTEXT_MAX = 240                      # 正文摘要截断长度
TIMEOUT = 45
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reddit_posts.json')


def build_url(ticker):
    q = urllib.parse.urlencode({'query': ticker, 'limit': LIMIT, 'sort': 'new'})
    return API + '?' + q


def fetch(ticker, key):
    """先试 curl（本机有 HTTPS 拦截，Python 校验会失败、curl 走系统证书链能过），
    curl 不可用再退回 urllib 并关校验。key 只进请求头，绝不落盘、绝不打印。"""
    req = urllib.request.Request(build_url(ticker), headers={
        'x-oanor-key': key,
        'User-Agent': 'curl/8',
        'Accept': 'application/json',
    })
    try:
        raw = subprocess.run(
            ['curl', '-sS', '--max-time', str(TIMEOUT), '-H', 'x-oanor-key: ' + key,
             build_url(ticker)],
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


def norm(ticker, j):
    """统一字段 → 前端只依赖这些键。缺字段一律给安全默认值。"""
    data = (j or {}).get('data') or {}
    posts = data.get('posts') or []
    out = []
    seen = set()
    for p in posts:
        pid = str(p.get('id') or p.get('permalink') or '')
        if not pid or pid in seen:
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
    # sort=new 本就倒序，这里再排一次保证严格有序（多轮合并不依赖对方顺序）
    out.sort(key=lambda x: x['created_utc'], reverse=True)
    out = out[:KEEP]
    return {'ticker': ticker, 'count': len(out), 'posts': out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tickers', default=','.join(DEFAULT_TICKERS),
                    help='要抓的标的代码，逗号分隔')
    ap.add_argument('-o', '--output', default=OUT, help='输出 JSON 路径')
    args = ap.parse_args()

    key = os.environ.get('OANOR_KEY', '').strip()
    if not key:
        print('[reddit] 未设置环境变量 OANOR_KEY —— '
              '请在仓库 Settings → Secrets 里添加后再跑', file=sys.stderr)
        return 1

    tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
    result, failed = {}, []
    for i, t in enumerate(tickers):
        if i:
            time.sleep(3)          # 短窗口有约 3 次/十几秒的突发限制，串行时留点空隙
        try:
            j = fetch(t, key)
        except Exception as e:                              # noqa: BLE001
            failed.append('%s: %s' % (t, e))
            continue
        if not (j or {}).get('success'):
            failed.append('%s: %s' % (t, (j or {}).get('message') or '接口返回失败'))
            continue
        result[t] = norm(t, j)
        print('[reddit] %s：%d 条' % (t, result[t]['count']))

    if not result:
        # 一个都没抓到：保留上一版文件（工作流里这一天就没数据，但不会把页面搞空）
        print('[reddit] 本次全部失败（%s），不覆盖已有文件 %s'
              % ('; '.join(failed) or '未知原因', args.output), file=sys.stderr)
        return 0

    out = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'oanor reddit-api (search/posts, sort=new)',
        'note': '只抓帖子列表，不含评论正文（评论要按帖单独计费）',
        'tickers': result,
    }
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
        f.write('\n')
    print('[reddit] 已写入 %s：%s' % (args.output, '、'.join(
        '%s %d 条' % (k, v['count']) for k, v in result.items())))
    if failed:
        print('[reddit] 部分失败：%s' % '; '.join(failed), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())

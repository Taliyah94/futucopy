#!/usr/bin/env python3
"""抓取 USD→CNY/JPY/KRW/HKD 的日频汇率序列，写入项目根的 fx_rates.json。

为什么需要落地成文件：浏览器直连 api.frankfurter.dev 会偶发
`ERR_CERT_COMMON_NAME_INVALID`（本机 HTTPS 拦截），前端 fetch 静默失败后
基金估值就少掉汇率那层（表现为「汇率 +0.000%」）。
与 fund_holdings.json / Asset_parsed.json 一样走「本地 JSON + 每日 workflow 更新」
的模式最稳：前端优先读本文件，读不到再回退在线接口 + localStorage 缓存。

数据源：frankfurter（欧洲央行日频参考价，北京时间约 16:00 更新当日，周末不更新）。
⚠️ 只请求 base=USD 的多个 symbols，其他币种兑人民币用交叉汇率算：
   XXX/CNY = (USD/CNY) ÷ (USD/XXX)
   直查 ?base=KRW&symbols=CNY 只有 3 位有效数字（0.00495），日间 0.4% 的波动会被
   四舍五入吃掉一大半；USD/KRW ≈ 1353 有 5 位有效，精度高一个量级。
"""
import json
import os
import ssl
import subprocess
import sys
import urllib.request
from datetime import date, timedelta

SYMBOLS = 'CNY,JPY,KRW,HKD'
DAYS = 120                       # 覆盖基金净值日 + 足够长的历史
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fx_rates.json')
TIMEOUT = 20


def url():
    start = (date.today() - timedelta(days=DAYS)).isoformat()
    return f'https://api.frankfurter.dev/v1/{start}..?base=USD&symbols={SYMBOLS}'


def fetch():
    """⚠️ 本机有 HTTPS 拦截（MITM 代理），Python 校验会报
    `certificate is not valid for 'api.frankfurter.dev'`，而 curl 走系统证书链能过。
    所以先用 curl 抓；curl 不可用时才退回 urllib，并显式关校验 ——
    这里取的是公开汇率、不涉及任何凭据，关掉校验没有实际风险。"""
    try:
        raw = subprocess.run(['curl', '-sS', '--max-time', str(TIMEOUT), url()],
                             capture_output=True, timeout=TIMEOUT + 5)
        if raw.returncode == 0 and raw.stdout.strip():
            return json.loads(raw.stdout.decode('utf-8'))
    except Exception:                                        # noqa: BLE001
        pass
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(url(), timeout=TIMEOUT, context=ctx) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    try:
        j = fetch()
    except Exception as e:                                  # noqa: BLE001
        print('[fx] 抓取失败：%s' % e, file=sys.stderr)
        return 1
    if not j.get('rates'):
        print('[fx] 返回为空，不覆盖已有文件', file=sys.stderr)
        return 1
    out = {
        'updated': date.today().isoformat(),
        'source': 'frankfurter.dev (ECB daily reference rates)',
        'base': 'USD',
        'symbols': SYMBOLS.split(','),
        'start_date': j.get('start_date'),
        'end_date': j.get('end_date'),
        'rates': j['rates'],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, sort_keys=True)
        f.write('\n')
    print('[fx] 已写入 %s：%s ~ %s，%d 个交易日'
          % (OUT, j.get('start_date'), j.get('end_date'), len(j['rates'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())

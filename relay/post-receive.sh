#!/bin/bash
# futucopy GitHub 中继 hook（2026-10-20 方案A）—— 权威副本，与 OCI 实例上
# ~/futucopy/.git/hooks/post-receive 保持一致（改这个文件记得同步到服务器）。
#
# 背景：本机到 github.com:443 被网络阻断，git push 不可用 → 改推 OCI 中继机
# （ssh://oci-relay:futucopy，即 138.2.42.110），由本 hook 代推 GitHub。
# 本地推送：git push oci main
#
# 逻辑：只中继 main → fetch GitHub（Actions 每日写的数据快照可能产生新提交）
# → 把刚到家的 commit rebase 到 origin/main 之上保证快进 → 代推 GitHub。
# 服务器要求：git、~/.git-credentials（credential.helper store，PAT 600 权限）。
#
# 重建服务器时：装 git → 配凭据 → git clone GitHub 仓库 →
# git config receive.denyCurrentBranch updateInstead → 本文件拷成
# .git/hooks/post-receive 并 chmod +x。

REPO="$HOME/futucopy"
export GIT_DIR="$REPO/.git" GIT_WORK_TREE="$REPO"
cd "$REPO" || { echo "relay: 找不到 $REPO"; exit 1; }

only_main=1
while read -r old new ref; do
  if [ "$ref" != "refs/heads/main" ]; then echo "relay: 只中继 main，跳过 $ref"; only_main=0; fi
done
[ "$only_main" = "1" ] || exit 0

git fetch origin main --quiet || { echo "relay: fetch GitHub 失败（网络？）"; exit 1; }

if ! git merge-base --is-ancestor origin/main HEAD; then
  git rebase origin/main --quiet || { echo "relay: rebase 冲突，需登录服务器人工处理"; exit 1; }
fi

if ! git push origin HEAD:main --quiet; then
  echo "relay: 首次代推被拒，重试一次"
  git fetch origin main --quiet && git rebase origin/main --quiet || { echo "relay: 重试 rebase 失败"; exit 1; }
  git push origin HEAD:main --quiet || { echo "relay: 代推 GitHub 失败"; exit 1; }
fi
echo "relay: OK -> GitHub main $(git rev-parse --short origin/main)"

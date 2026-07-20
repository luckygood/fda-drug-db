#!/usr/bin/env bash
# monthly_refresh.sh — 三源月更管线：抓取 → 导出 → 监控摘要 → 构建 → 部署 gh-pages
#
# 幂等、可重复执行。单源失败不拖垮整体：该源保留旧数据，failures 记录，流程继续。
# 退出码：0 = 全部成功；2 = 部分失败；1 = 全部失败（三源抓取全挂，或构建/部署失败导致无法上线）。
#
# 用法：bash fda-drug-web/scripts/monthly_refresh.sh
# 详见 fda-drug-web/scripts/RUNBOOK.md
set -uo pipefail

# ---------- 路径 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$WEB_DIR/.." && pwd)"          # 工作区根（含 fda_drugs.db / data_lake）
PY="${PYTHON:-python3}"
DATA_DIR="$WEB_DIR/public/data"
STATE_DIR="$ROOT/data_lake"
LOG_FILE="$STATE_DIR/monthly_refresh.log"

PUSH_IPS=(140.82.112.3 140.82.112.4 140.82.116.3 140.82.113.3 140.82.114.3 140.82.121.3)
GIT_ID=(-c user.name=luckygood -c user.email=luckygood@users.noreply.github.com)

mkdir -p "$STATE_DIR"
FAILURES=()   # 元素形如 "export_supply: 退出码 1"

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  echo "$line" >> "$LOG_FILE"
}

die_note() {  # 记录失败但继续
  FAILURES+=("$1")
  log "失败记录：$1"
}

# ---------- 步骤 ① 抓取三源 ----------
log "==== 月更开始 ==== 工作区：$ROOT"
log "步骤 1/5：抓取三源 → data_lake/"
FETCH_RC=0
(cd "$ROOT" && "$PY" fda-drug-web/scripts/fetch_sources.py) 2>&1 | tee -a "$LOG_FILE"
FETCH_RC=${PIPESTATUS[0]}
log "fetch_sources 退出码：$FETCH_RC（0 全成功 / 2 部分 / 1 全失败）"

# 抓取失败的源清单（供导出阶段跳过判断）
fetch_failed() {  # $1=source name；返回 0 表示该源抓取失败
  "$PY" - "$STATE_DIR/fetch_report.json" "$1" <<'EOF'
import json, sys
try:
    rep = json.load(open(sys.argv[1], encoding="utf-8"))
    failed = {f["source"] for f in rep.get("failures", [])}
    sys.exit(0 if sys.argv[2] in failed else 1)
except Exception:
    sys.exit(1)
EOF
}

if [ "$FETCH_RC" -eq 1 ]; then
  log "三源抓取全部失败 → 保留全部旧数据，仍尝试用旧数据走完整流程"
fi

# ---------- 步骤 ② 导出三个 JSON（带备份/回滚） ----------
log "步骤 2/5：导出 patent_cliff / supply_risk / biosimilars"
BACKUP_DIR="$STATE_DIR/.backup-json"
mkdir -p "$BACKUP_DIR"
cp -f "$DATA_DIR/patent_cliff.json" "$BACKUP_DIR/" 2>/dev/null || true
cp -f "$DATA_DIR/supply_risk.json" "$BACKUP_DIR/" 2>/dev/null || true
cp -f "$DATA_DIR/biosimilars.json" "$BACKUP_DIR/" 2>/dev/null || true

run_export() {  # $1=脚本名 $2=产物文件名 $3=源名（对应 fetch_report 的 source）
  local script="$1" json="$2" src="$3"
  if fetch_failed "$src"; then
    log "跳过 $script（$src 抓取失败，保留旧 $json）"
    return 0
  fi
  if (cd "$ROOT" && "$PY" "fda-drug-web/scripts/$script") >> "$LOG_FILE" 2>&1; then
    log "$script 成功 → $json"
  else
    local rc=$?
    if [ -f "$BACKUP_DIR/$json" ]; then
      cp -f "$BACKUP_DIR/$json" "$DATA_DIR/$json"
      log "$script 失败（rc=$rc），已回滚 $json 为旧版本"
    else
      log "$script 失败（rc=$rc），无旧版本可回滚"
    fi
    die_note "export_$src: 退出码 $rc（已保留旧数据）"
  fi
}

run_export export_orangebook.py patent_cliff.json orangebook
run_export export_supply.py supply_risk.json shortages
run_export export_purplebook.py biosimilars.json purplebook

# ---------- 步骤 ③ 监控摘要 ----------
log "步骤 3/5：生成 monitor_summary.json"
EXTRA_ARGS=()
if [ "${#FAILURES[@]}" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do EXTRA_ARGS+=(--extra-failure "$f"); done
fi
if (cd "$ROOT" && "$PY" fda-drug-web/scripts/build_monitor_summary.py ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}) >> "$LOG_FILE" 2>&1; then
  log "monitor_summary.json 已生成"
else
  die_note "build_monitor_summary: 退出码 $?"
fi

# 部署 checkout -f main 会把工作树还原到 main 最近提交——先把刷新后的数据提交到 main，
# 保证部署后工作区与线上一致（幂等：无变化则跳过；脚本源码改动须运行前手动提交，见 RUNBOOK）
if ! (cd "$WEB_DIR" && git diff --quiet -- public/data) 2>/dev/null; then
  if (cd "$WEB_DIR" && git add public/data/patent_cliff.json public/data/supply_risk.json \
        public/data/biosimilars.json public/data/monitor_summary.json && \
      git "${GIT_ID[@]}" commit -qm "data: 月更数据 $(date '+%Y-%m-%d')") >> "$LOG_FILE" 2>&1; then
    log "刷新后数据已提交到 main"
  else
    die_note "main_commit: 数据 JSON 提交 main 失败"
  fi
fi

# ---------- 步骤 ④ 构建 ----------
log "步骤 4/5：npm run build"
BUILD_OK=0
(cd "$WEB_DIR" && npm run build) >> "$LOG_FILE" 2>&1
BUILD_OK=$?
if [ "$BUILD_OK" -ne 0 ]; then
  log "构建失败（rc=$BUILD_OK）。如为 esbuild 挂起，可执行 killall bird 后重跑"
  die_note "build: npm run build 退出码 $BUILD_OK"
fi

# ---------- 步骤 ⑤ 部署 gh-pages ----------
DEPLOY_OK=1
if [ "$BUILD_OK" -eq 0 ]; then
  log "步骤 5/5：部署 gh-pages 孤儿分支"
  (
    set -e
    cd "$WEB_DIR"
    git checkout --orphan gh-pages-tmp -q
    git rm -rfq .
    cp -R dist/* .
    git add index.html assets data        # 显式列举，严禁 git add -A
    git "${GIT_ID[@]}" commit -qm "deploy: 月更 $(date '+%Y-%m-%d')"
  ) >> "$LOG_FILE" 2>&1
  if [ $? -eq 0 ]; then
    PUSHED=0
    for ip in "${PUSH_IPS[@]}"; do
      log "push gh-pages 尝试 IP $ip"
      if (cd "$WEB_DIR" && git -c http.curloptResolve="github.com:443:$ip" \
            -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
            push -f origin gh-pages-tmp:gh-pages) >> "$LOG_FILE" 2>&1; then
        PUSHED=1
        log "gh-pages 推送成功（IP $ip）"
        break
      fi
      sleep 6
    done
    (cd "$WEB_DIR" && git checkout -f main -q && git branch -D gh-pages-tmp -q) >> "$LOG_FILE" 2>&1 || true
    if [ "$PUSHED" -eq 1 ]; then
      DEPLOY_OK=0
    else
      die_note "deploy: gh-pages 推送全部 IP 失败"
    fi
  else
    die_note "deploy: gh-pages 分支准备失败（详见日志）"
    (cd "$WEB_DIR" && git checkout -f main -q && git branch -D gh-pages-tmp -q) >> "$LOG_FILE" 2>&1 || true
  fi
else
  log "步骤 5/5：跳过（构建失败）"
fi

# 部署失败时用 site_deployed=false 重写摘要（仅本地，不推送——线上仍是上一份成功部署的摘要）
if [ "$DEPLOY_OK" -ne 0 ]; then
  EXTRA_ARGS=(--site-deployed false)
  if [ "${#FAILURES[@]}" -gt 0 ]; then
    for f in "${FAILURES[@]}"; do EXTRA_ARGS+=(--extra-failure "$f"); done
  fi
  (cd "$ROOT" && "$PY" fda-drug-web/scripts/build_monitor_summary.py "${EXTRA_ARGS[@]}") >> "$LOG_FILE" 2>&1 || true
fi

# ---------- 汇总与退出码 ----------
N_FAIL=${#FAILURES[@]}
if [ "$FETCH_RC" -eq 1 ]; then
  FINAL=1
elif [ "$N_FAIL" -eq 0 ]; then
  FINAL=0
else
  FINAL=2
fi
log "==== 月更结束 ==== 失败环节 $N_FAIL 个，退出码 $FINAL"
[ "$N_FAIL" -gt 0 ] && log "失败清单：${FAILURES[*]}"
exit $FINAL

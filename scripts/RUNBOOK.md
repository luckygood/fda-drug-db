# RUNBOOK · 三源月更管线执行手册

给定时任务（cron job）执行代理看的运行手册。管线 = 抓取三源 → 导出 JSON → 监控摘要 → 构建 → 部署 gh-pages。

## 0. 一句话用法

```bash
bash "/Users/dingzhiqiang/Documents/Kimi/Workspaces/Drug on market/fda-drug-web/scripts/monthly_refresh.sh"
echo "exit=$?"   # 0 全成功 / 2 部分失败 / 1 全部失败
```

脚本自定位路径，从任何 cwd 运行均可。全程日志追加写入 `data_lake/monthly_refresh.log`（工作区根下），stdout 同步输出。

## 1. 前置依赖（缺一不可）

| 依赖 | 位置 / 检查 |
|---|---|
| 工作区根 | `/Users/dingzhiqiang/Documents/Kimi/Workspaces/Drug on market/`（脚本向上两级推导） |
| `fda_drugs.db` | 工作区根，导出脚本必读（单一来源判定、锚点、交叉校验） |
| `fda_aux.db` | 工作区根，导出脚本读写（ob_* / shortage / purplebook / meta 表） |
| `data_lake/` | 工作区根，抓取落盘处；首跑已有三源数据，抓取失败时作旧数据兜底 |
| `node_modules` | `fda-drug-web/node_modules`（`ls fda-drug-web/node_modules | wc -l` 应≈258）；若缺失先 `cd fda-drug-web && npm install` |
| python3 | Kimi 托管运行时（`.../daimon/runtime/python/.venv/bin/python3`），仅用标准库；可用 `PYTHON=/path/python3` 覆盖 |
| node / npm | Kimi 运行时自带（`/Applications/Kimi.app/.../runtime/node`） |
| git 凭据 | repo `fda-drug-web/.git`，remote `https://github.com/luckygood/fda-drug-db.git`；推送走 https + `http.curloptResolve` 指定 IP，无需交互凭据（公共仓 + 已缓存凭据） |

## 2. 每步预期产物

| 步骤 | 命令 | 成功产物 | 失败行为 |
|---|---|---|---|
| ① 抓取 | `python3 fda-drug-web/scripts/fetch_sources.py` | `data_lake/orangebook/drug-orangebook-0001-of-0001.json`、`data_lake/shortages/drug-shortages-0001-of-0001.json`、`data_lake/purplebook/purplebook-search-<Month>-<YYYY>-data-download.csv`（新版才落盘）、`data_lake/fetch_report.json` | 单源失败保留旧文件，failures 记录，退出码 2；全失败退出码 1 |
| ② 导出 | `export_orangebook.py` / `export_supply.py` / `export_purplebook.py` | `public/data/{patent_cliff,supply_risk,biosimilars}.json` | 抓取失败的源跳过导出；导出失败自动回滚该 JSON 为旧版（备份在 `data_lake/.backup-json/`） |
| ③ 摘要 | `build_monitor_summary.py` | `public/data/monitor_summary.json` | 失败记入 failures，继续 |
| ④ 构建 | `cd fda-drug-web && npm run build` | `dist/`（含 `assets/index-<hash>.js`） | 失败则跳过部署，最终退出码 2 |
| ⑤ 部署 | gh-pages 孤儿分支（脚本内） | 远端 `gh-pages` 分支强推更新 | 6 个 GitHub IP 轮换重试；全失败记 failures，退出码 2 |

## 3. 常见失败与处置

- **DNS 阻断 / push 超时**：脚本已对 push 做 `http.curloptResolve=github.com:443:<IP>` 轮换（140.82.112.3 / .112.4 / .116.3 / .113.3 / .114.3 / .121.3，间隔 6s）。全部失败时查本机代理/网络，勿徒手改 push 逻辑。
- **esbuild 挂起（构建卡死无输出）**：`killall bird` 后重跑脚本（鸟进程是已知干扰源）。
- **紫皮书抓取 522 / 空响应**：allorigins 代理间歇故障属常态，脚本已对每个月份候选重试 6 次（间隔 8s）、并依次回退当月→上月→上上月。若当月新版尚未发布（月初滞后），且本地已有同月文件，视为成功跳过（幂等）。
- **fda.gov 主站 302 → abuse 页**：预期行为。橙皮书/短缺走 `download.open.fda.gov`（不被拦），紫皮书走代理；不要尝试直连 `purplebooksearch.fda.gov`。
- **代理取回 HTML 错误页**：脚本校验 CSV 表头（`BLA Number`），不合格自动丢弃重试。
- **`git add` 纪律**：部署只允许 `git add index.html assets data`，**严禁 `git add -A`**（会把 node_modules 纳入孤儿分支索引，切回 main 时污染工作区）。
- **7100 端口**：平台预览服务，任何清理操作都不要杀它。
- **退出码 1 的含义**：三源抓取全部失败。此时旧 JSON 未动，脚本仍会用旧数据完成摘要/构建/部署（保证站点可用），但 failures 里会有三条 fetch 记录，看板应显示数据停滞。

## 4. 部分失败时 monitor_summary.json 如何体现

- `failures` 数组：每条形如 `fetch_shortages: 下载失败：rc=28 ...（沿用旧数据）` 或 `export_purplebook: 退出码 1（已保留旧数据）`、`build: ...`、`deploy: ...`。
- 各源版本字段（`ob_version` / `shortages_version` / `pb_version`）来自成品 JSON 本身——某源失败时其版本日期自然停留在旧版，与 failures 记录互证。
- `site_deployed`：线上 Pages 服务到的文件恒为 `true`（能被读到即部署成功）；仅当本次部署失败时脚本用 `--site-deployed false` 重写**本地**副本（不推送），供本地排查。
- `summary` 一句话末尾会附「本次 N 个环节失败。」。

## 5. 手动单步调试

```bash
cd "/Users/dingzhiqiang/Documents/Kimi/Workspaces/Drug on market"
python3 fda-drug-web/scripts/fetch_sources.py          # 只抓取
python3 fda-drug-web/scripts/export_supply.py          # 只导某一源
python3 fda-drug-web/scripts/build_monitor_summary.py --extra-failure "test: 演练"
```

导出脚本均以自身位置推导工作区根（`Path(__file__).parents[2]`），从任意 cwd 运行均可；抓取脚本同理。

## 6. 定时任务接线建议

建议每月 5 日（紫皮书月度版通常在月初后数日发布）运行一次，非整点分钟（如 07:43）。执行后检查退出码与 `monitor_summary.json` 的 `failures`，部分失败（退出码 2）通常无需干预——下月会自动自愈；退出码 1 或连续两月同一源失败需人工排查。

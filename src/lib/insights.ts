// 规则式模板解读：由 entity_map / report_metrics 的确定性字段插值生成要点句，
// 每条附来源标签；不做任何推断或外部数据补充。缺指标时返回空数组（不硬撑）。
import type { DiseaseMetrics, IngredientMetrics, LifecycleRecord } from './data';

export interface Insight {
  text: string;
  source: string;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function diseaseInsights(
  m: DiseaseMetrics | undefined,
  opts: { nameZh: string; topCompanyName?: string },
): Insight[] {
  if (!m) return [];
  const out: Insight[] = [];
  const crowdSrc = '〔基于 entity_map 全量计数〕';
  if (m.crowded_bucket === '前25%') {
    out.push({
      text: `${opts.nameZh}相关成分 ${m.ingredients_total} 个，拥挤度位于全部疾病前 25%，属于竞争密集赛道。`,
      source: crowdSrc,
    });
  } else if (m.crowded_bucket === '后25%') {
    out.push({
      text: `${opts.nameZh}相关成分 ${m.ingredients_total} 个，拥挤度位于全部疾病后 25%，赛道相对冷清。`,
      source: crowdSrc,
    });
  }
  if (m.hhi_bucket === '集中' && m.top_company) {
    const share = m.top_company_share != null ? `，份额 ${pct(m.top_company_share)}` : '';
    out.push({
      text: `企业集中度处于全部疾病前 25%（HHI ${m.hhi.toFixed(2)}），头部企业（${opts.topCompanyName ?? m.top_company}${share}）主导。`,
      source: '〔基于 entity_map 企业份额与 report_metrics 衍生指标〕',
    });
  } else if (m.hhi_bucket === '分散') {
    out.push({
      text: `企业集中度处于全部疾病后 25%（HHI ${m.hhi.toFixed(2)}），竞争格局分散。`,
      source: '〔基于 entity_map 企业份额与 report_metrics 衍生指标〕',
    });
  }
  return out;
}

export function ingredientInsights(rec: LifecycleRecord, m: IngredientMetrics | undefined): Insight[] {
  if (!m) return [];
  const out: Insight[] = [];
  const e = m.erosion;
  if (e?.stage === '充分竞争' && e.n_anda_companies != null) {
    out.push({
      text: `仿制竞争充分：${e.n_anda_companies} 家仿制药企持证，原研份额承压。`,
      source: '〔基于 report_metrics 衍生指标〕',
    });
  } else if (e?.stage === '多家竞争' && e.n_anda_companies != null) {
    out.push({
      text: `仿制竞争加剧：${e.n_anda_companies} 家仿制药企已持证。`,
      source: '〔基于 report_metrics 衍生指标〕',
    });
  }
  // "无仿制" 对生物药会误伤（ANDA 仅覆盖化药），不产句。
  if (m.exclusivity_pct != null && m.exclusivity_pct <= 0.25 && rec.first_approval) {
    out.push({
      text: `专利/独占剩余时间在 ${rec.first_approval.slice(0, 4)} 年同批成分中处于后 25% 分位，独占期接近尾声。`,
      source: '〔基于 report_metrics 衍生指标〕',
    });
  }
  const ev = m.evidence;
  if (ev) {
    out.push({
      text: `近三年临床文献 ${ev.clinical_count} 篇（年均 ${ev.per_year} 篇），证据活跃度：${ev.bucket}。`,
      source: '〔PubMed 标题/摘要匹配，目前仅覆盖引入期成分〕',
    });
  }
  const g = m.global_score;
  if (g != null) {
    if (g >= 1) {
      out.push({ text: '美欧日三地均已可及。', source: '〔基于 report_metrics 衍生指标〕' });
    } else if (g <= 0.4) {
      out.push({ text: '目前仅 FDA 可及，EMA / PMDA 均未检索到该成分。', source: '〔基于 report_metrics 衍生指标〕' });
    }
  }
  return out;
}

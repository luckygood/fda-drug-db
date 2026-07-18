#!/usr/bin/env python3
"""离线批量导出"疾病→药物"JSON，供 fda-drug-web 疾病视角页静态加载。

复用 disease_drugs.py 的 FTS 检索 / 去重 / 关联 / 片段提取逻辑。
输出:
  fda-drug-web/public/data/diseases/index.json
  fda-drug-web/public/data/diseases/<slug>.json
"""
import json
import os
import re
import sqlite3
import time

from disease_drugs import (
    DB_DRUGS,
    DB_LABELS,
    efficacy_snippet,
    fts_query,
    split_study_sections,
    unpack,
)

OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "fda-drug-web", "public", "data", "diseases",
)

# ---------------- 提取式摘要卡 ----------------

# 试验名排除词（非试验名的常见全大写缩写）
TRIAL_DENY = {
    "STUDY", "TRIAL", "TRIALS", "GROUP", "ARM", "PART", "PHASE", "TABLE", "FIGURE",
    "PATIENTS", "TREATMENT", "MONTHS", "WEEKS", "DAYS", "YEARS", "RANDOMIZED",
    "DOUBLE", "BLIND", "PLACEBO", "OVERALL", "SURVIVAL", "RESPONSE", "MEDIAN",
    "PRIMARY", "SECONDARY", "ENDPOINT", "SAFETY", "EFFICACY", "ANALYSIS", "DATA",
    "RESULTS", "RISK", "RATIO", "RATE", "CONTROL", "OPEN", "LABEL", "MULTICENTER",
    "SINGLE", "GLOBAL", "FDA", "NCI", "ECOG", "RECIST", "WHO", "BICR", "INV",
    "ITT", "OS", "PFS", "ORR", "DCR", "DOR", "HR", "CI", "AE", "SAE", "TEAE",
    "CR", "PR", "SD", "PD", "IV", "PO", "QD", "BID", "MG", "MCG", "ML", "KG",
    "ULN", "AST", "ALT", "ECG", "DNA", "RNA", "PCR", "PET", "MRI", "NSCLC",
    "SCLC", "EGFR", "ALK", "ROS1", "KRAS", "BRAF", "HER2", "PDL1", "VEGF",
    "TKI", "NCCN", "ASCO", "ESMO", "CNS", "ILD", "QT", "NHL", "AML", "ALL",
    "CLL", "CML", "MDS", "HCC", "RCC", "GIST", "GBM", "HNSCC", "MCC", "MSI",
    "MMR", "TMB", "DFS", "EFS", "PFS2", "IDFS", "BCFI", "CSS", "RFS", "MFS",
}

def norm_text(text):
    """归一化 FDA 文本：连字符变体 → 普通连字符。"""
    if not text:
        return ""
    return (
        text.replace("‑", "-")  # U+2011 non-breaking hyphen
        .replace("‐", "-")  # U+2010
        .replace("–", "-")  # U+2013 en dash
        .replace("—", "-")  # U+2014 em dash
    )


RESULT_KEYWORDS = [
    "overall survival", "progression-free", "objective response", "response rate",
    "hazard ratio", "median os", "median pfs", "median survival", "months",
    "p<0.", "p = ", "%", "significantly", "primary endpoint", "met its",
    "randomized", "superior", "improved", "improvement", "reduction",
    "complete response", "partial response", "disease-free", "event-free",
    "duration of response", "confirmed response", "reduced the risk",
    "demonstrated", "statistically significant",
]

# 基线特征/方法学句降权词
RESULT_PENALTIES = [
    "characteristics", "median age", "ecog", "% male", "male;", "white",
    "enrolled", "stratified", "eligibility", "eligible", "dose of",
    "mg/m", "administered", "randomization", "baseline", "inclusion",
]


def extract_trials(text):
    """提取试验名称/编号：命名试验优先（KEYNOTE-006 / ADAURA），NCT 号补充，去重最多 4。"""
    out, seen = [], set()

    def add(t):
        if t and t not in seen:
            seen.add(t)
            out.append(t)

    named, ncts = [], []
    for m in re.finditer(r"NCT\d{8}", text):
        if m.group(0) not in seen:
            ncts.append(m.group(0))
            seen.add(m.group(0))
    # 名称-数字模式：KEYNOTE-006、CheckMate-816、IMpower150
    for m in re.finditer(r"\b([A-Za-z][A-Za-z0-9]*-\d{2,4})\b", text):
        t = m.group(1)
        if t.upper() in TRIAL_DENY or len(t) < 5:
            continue
        if not re.search(r"[A-Z]{2,}", t):
            continue
        if t not in seen:
            seen.add(t)
            named.append(t)
    # 全大写命名试验：ADAURA、FLAURA、ALEX（需 trial/study 语境）
    for m in re.finditer(r"\b([A-Z]{3,12})\b", text):
        t = m.group(1)
        if t in TRIAL_DENY or t in seen:
            continue
        s = max(0, m.start() - 80)
        e = min(len(text), m.end() + 80)
        ctx = text[s:e].lower()
        if "trial" not in ctx and "study" not in ctx:
            continue
        seen.add(t)
        named.append(t)
    for t in named + ncts:
        if len(out) >= 4:
            break
        out.append(t)
    return out


def extract_key_results(text, max_sents=4, max_chars=600):
    """按关键词评分选 top 句，保原文顺序，总 ≤600 字符。"""
    sents = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(])", text)
    scored = []
    for i, s in enumerate(sents):
        sl = s.lower()
        if len(s) < 40 or len(s) > 400:
            continue
        score = sum(1 for k in RESULT_KEYWORDS if k in sl)
        score -= 2 * sum(1 for k in RESULT_PENALTIES if k in sl)
        if re.search(r"\d", s):
            score += 2
        scored.append((score, i, s))
    top = sorted((x for x in scored if x[0] >= 3), key=lambda x: -x[0])[:max_sents]
    top.sort(key=lambda x: x[1])
    out, total = [], 0
    for _, _, s in top:
        s = re.sub(r"\s+", " ", s).strip()
        if total + len(s) > max_chars:
            break
        out.append(s)
        total += len(s)
    return out


def select_disease_section(clinical_text, keywords):
    """定位与疾病相关的小节，返回 (heading, body) 或 None。"""
    for heading, body in split_study_sections(clinical_text):
        hay = (heading + " " + body).lower()
        if any(k in hay for k in keywords):
            return heading, body
    return None


def build_efficacy_card(clinical_text, keywords):
    clinical_text = norm_text(clinical_text)
    if not clinical_text:
        return None
    sec = select_disease_section(clinical_text, keywords)
    if not sec:
        return None
    heading, body = sec
    trials = extract_trials(body)
    key_results = extract_key_results(body)
    if not trials and not key_results:
        return None
    return {
        "trials": trials,
        "key_results": key_results,
        "source_section": heading,
    }


# warnings 小标题截断标记：正文从助动词/功能词开始
WARN_CUT_MARKERS = [
    " is ", " are ", " can ", " may ", " should ", " has ", " have ",
    " was ", " were ", " will ", " did ", " been ", " occurs", " led ",
    " this ", " these ", " there ", " it ", " if ", " because ",
    " due to ", " resulting ", " in postmarketing", " based on ",
]
WARN_CONNECTORS = {
    "and", "or", "of", "in", "with", "without", "for", "to", "the", "a",
    "an", "by", "on", "at", "from", "when", "during", "after", "before",
}


def clean_warning_heading(raw):
    """把 '5.1 标题 正文起始…' 截断为纯小标题。"""
    h = raw
    cut = len(h)
    low = h.lower()
    for m in WARN_CUT_MARKERS:
        pos = low.find(m)
        if 5 < pos < cut:
            cut = pos
    h = h[:cut].strip()
    # 剥尾部：全大写词（药名）、小写词（正文残留）、连接词
    words = h.split()
    popped_lower = False
    while words:
        w = words[-1].strip(";:,–-")
        if (w.isupper() and len(w) > 2) or w.lower() in WARN_CONNECTORS:
            words.pop()
        elif w and w[0].islower():
            words.pop()
            popped_lower = True
        else:
            break
    # 剥过小写正文词时，再剥一个 Title Case 残留（正文首词常大写开头）
    if popped_lower and words and words[-1][:1].isupper() and not words[-1].isupper():
        words.pop()
    return " ".join(words).strip(";:,–-")


def build_safety_card(boxed, warnings, adverse):
    boxed = norm_text(boxed)
    warnings = norm_text(warnings)
    adverse = norm_text(adverse)
    if not (boxed or warnings or adverse):
        return None
    card = {
        "boxed_warning": re.sub(r"\s+", " ", boxed).strip()[:400] if boxed else None,
        "warnings": [],
        "common_adverse_reactions": None,
    }
    if warnings:
        heads = re.findall(r"\b(\d+\.\d+\s+[A-Z][^.\n]{5,80})", warnings)
        seen, ws = set(), []
        for h in heads:
            h = re.sub(r"\s+", " ", h).strip()
            h = clean_warning_heading(h)
            if len(h) < 8 or h.lower() in seen:
                continue
            seen.add(h.lower())
            ws.append(h)
        card["warnings"] = ws[:8]
    if adverse:
        m = re.search(
            r"[^.]*most common[^.]*adverse reactions?[^.]*\.(\s*[^.]*\.)?",
            adverse,
            re.IGNORECASE,
        )
        if m:
            card["common_adverse_reactions"] = re.sub(r"\s+", " ", m.group(0)).strip()[:400]
        else:
            card["common_adverse_reactions"] = re.sub(r"\s+", " ", adverse).strip()[:200]
    return card


SIZE_LIMIT = 1_900_000  # 单疾病 JSON 软上限（字节）
CARDS_KEEP = 200  # 超限时按获批日期倒序保留卡片的药数

# (slug, 中文名, 英文名, [同义词], 治疗领域)
DISEASES = [
    # 肿瘤
    ("nsclc", "非小细胞肺癌", "non-small cell lung cancer", ["NSCLC", "non small cell lung cancer", "nonsmall cell lung cancer"], "肿瘤"),
    ("sclc", "小细胞肺癌", "small cell lung cancer", ["SCLC"], "肿瘤"),
    ("breast-cancer", "乳腺癌", "breast cancer", ["mammary carcinoma"], "肿瘤"),
    ("colorectal-cancer", "结直肠癌", "colorectal cancer", ["colon cancer", "rectal cancer", "colorectal carcinoma"], "肿瘤"),
    ("gastric-cancer", "胃癌", "gastric cancer", ["stomach cancer", "gastric carcinoma", "gastroesophageal junction"], "肿瘤"),
    ("liver-cancer", "肝癌", "hepatocellular carcinoma", ["HCC", "liver cancer"], "肿瘤"),
    ("pancreatic-cancer", "胰腺癌", "pancreatic cancer", ["pancreatic carcinoma", "pancreatic adenocarcinoma"], "肿瘤"),
    ("ovarian-cancer", "卵巢癌", "ovarian cancer", ["ovarian carcinoma", "fallopian tube cancer", "primary peritoneal cancer"], "肿瘤"),
    ("prostate-cancer", "前列腺癌", "prostate cancer", ["prostatic carcinoma", "prostate adenocarcinoma"], "肿瘤"),
    ("bladder-cancer", "膀胱癌", "bladder cancer", ["urothelial carcinoma", "bladder carcinoma"], "肿瘤"),
    ("kidney-cancer", "肾癌", "renal cell carcinoma", ["RCC", "kidney cancer", "renal cancer"], "肿瘤"),
    ("melanoma", "黑色素瘤", "melanoma", ["malignant melanoma", "metastatic melanoma"], "肿瘤"),
    ("aml", "急性髓系白血病", "acute myeloid leukemia", ["AML", "acute myelogenous leukemia", "acute myelocytic leukemia"], "肿瘤"),
    ("all", "急性淋巴细胞白血病", "acute lymphoblastic leukemia", ["acute lymphocytic leukemia", "acute lymphoid leukemia"], "肿瘤"),
    ("cll", "慢性淋巴细胞白血病", "chronic lymphocytic leukemia", ["CLL", "small lymphocytic lymphoma", "SLL"], "肿瘤"),
    ("cml", "慢性髓系白血病", "chronic myeloid leukemia", ["CML", "chronic myelogenous leukemia", "chronic myelocytic leukemia"], "肿瘤"),
    ("hodgkin-lymphoma", "霍奇金淋巴瘤", "Hodgkin lymphoma", ["Hodgkin's lymphoma", "Hodgkin disease", "classical Hodgkin"], "肿瘤"),
    ("non-hodgkin-lymphoma", "非霍奇金淋巴瘤", "non-Hodgkin lymphoma", ["NHL", "non Hodgkin lymphoma", "diffuse large B-cell lymphoma", "follicular lymphoma"], "肿瘤"),
    ("multiple-myeloma", "多发性骨髓瘤", "multiple myeloma", ["myeloma"], "肿瘤"),
    ("mds", "骨髓增生异常综合征", "myelodysplastic syndrome", ["MDS", "myelodysplasia"], "肿瘤"),
    ("glioblastoma", "胶质母细胞瘤", "glioblastoma", ["GBM", "glioblastoma multiforme"], "肿瘤"),
    ("head-neck-cancer", "头颈鳞癌", "head and neck squamous cell carcinoma", ["HNSCC", "head and neck cancer"], "肿瘤"),
    ("esophageal-cancer", "食管癌", "esophageal cancer", ["oesophageal cancer", "esophageal carcinoma", "esophageal squamous"], "肿瘤"),
    ("cervical-cancer", "宫颈癌", "cervical cancer", ["cervical carcinoma", "cancer of the cervix"], "肿瘤"),
    ("endometrial-cancer", "子宫内膜癌", "endometrial cancer", ["endometrial carcinoma", "uterine cancer"], "肿瘤"),
    ("thyroid-cancer", "甲状腺癌", "thyroid cancer", ["thyroid carcinoma", "medullary thyroid", "differentiated thyroid"], "肿瘤"),
    ("neuroblastoma", "神经母细胞瘤", "neuroblastoma", [], "肿瘤"),
    ("sarcoma", "肉瘤", "sarcoma", ["soft tissue sarcoma", "osteosarcoma", "liposarcoma", "leiomyosarcoma"], "肿瘤"),
    ("gist", "胃肠道间质瘤", "gastrointestinal stromal tumor", ["GIST", "gastrointestinal stromal tumour"], "肿瘤"),
    ("merkel-cell", "默克尔细胞癌", "Merkel cell carcinoma", ["MCC"], "肿瘤"),
    # 代谢内分泌
    ("type-2-diabetes", "2型糖尿病", "type 2 diabetes", ["type 2 diabetes mellitus", "T2DM", "non-insulin dependent diabetes"], "代谢内分泌"),
    ("type-1-diabetes", "1型糖尿病", "type 1 diabetes", ["type 1 diabetes mellitus", "T1DM", "insulin dependent diabetes"], "代谢内分泌"),
    ("obesity", "肥胖", "obesity", ["weight reduction", "chronic weight management", "overweight"], "代谢内分泌"),
    ("hyperlipidemia", "高血脂", "hyperlipidemia", ["hypercholesterolemia", "dyslipidemia", "hypertriglyceridemia"], "代谢内分泌"),
    ("hypothyroidism", "甲状腺功能减退", "hypothyroidism", ["thyroid hormone deficiency"], "代谢内分泌"),
    ("osteoporosis", "骨质疏松", "osteoporosis", ["postmenopausal osteoporosis", "bone loss"], "代谢内分泌"),
    ("gout", "痛风", "gout", ["hyperuricemia", "gouty arthritis"], "代谢内分泌"),
    # 心血管
    ("hypertension", "高血压", "hypertension", ["high blood pressure", "essential hypertension"], "心血管"),
    ("heart-failure", "心力衰竭", "heart failure", ["chronic heart failure", "CHF", "reduced ejection fraction"], "心血管"),
    ("atrial-fibrillation", "房颤", "atrial fibrillation", ["nonvalvular atrial fibrillation"], "心血管"),
    ("angina", "心绞痛", "angina", ["angina pectoris", "chronic stable angina"], "心血管"),
    ("pah", "肺动脉高压", "pulmonary arterial hypertension", ["PAH", "pulmonary hypertension"], "心血管"),
    ("vte", "静脉血栓栓塞", "venous thromboembolism", ["VTE", "deep vein thrombosis", "DVT", "pulmonary embolism"], "心血管"),
    # 呼吸
    ("asthma", "哮喘", "asthma", ["bronchial asthma"], "呼吸"),
    ("copd", "慢阻肺", "chronic obstructive pulmonary disease", ["COPD", "chronic bronchitis", "emphysema"], "呼吸"),
    ("ipf", "特发性肺纤维化", "idiopathic pulmonary fibrosis", ["IPF"], "呼吸"),
    ("cystic-fibrosis", "囊性纤维化", "cystic fibrosis", ["CF"], "呼吸"),
    ("allergic-rhinitis", "过敏性鼻炎", "allergic rhinitis", ["seasonal allergic rhinitis", "perennial allergic rhinitis", "hay fever"], "呼吸"),
    # 消化
    ("ulcerative-colitis", "溃疡性结肠炎", "ulcerative colitis", [], "消化"),
    ("crohns-disease", "克罗恩病", "Crohn's disease", ["Crohn disease", "regional enteritis"], "消化"),
    ("ibs", "肠易激综合征", "irritable bowel syndrome", ["IBS"], "消化"),
    ("gerd", "胃食管反流", "gastroesophageal reflux disease", ["GERD", "erosive esophagitis", "heartburn"], "消化"),
    ("hepatitis-b", "乙肝", "hepatitis B", ["chronic hepatitis B", "HBV"], "消化"),
    ("hepatitis-c", "丙肝", "hepatitis C", ["chronic hepatitis C", "HCV"], "消化"),
    ("nash", "脂肪性肝炎", "nonalcoholic steatohepatitis", ["NASH", "nonalcoholic fatty liver disease", "MASH"], "消化"),
    # 神经精神
    ("alzheimers", "阿尔茨海默病", "Alzheimer's disease", ["Alzheimer disease", "dementia of the Alzheimer type"], "神经精神"),
    ("parkinsons", "帕金森病", "Parkinson's disease", ["Parkinson disease"], "神经精神"),
    ("epilepsy", "癫痫", "epilepsy", ["seizure disorder", "partial-onset seizures", "generalized seizures"], "神经精神"),
    ("multiple-sclerosis", "多发性硬化", "multiple sclerosis", ["relapsing multiple sclerosis", "relapsing-remitting multiple sclerosis"], "神经精神"),
    ("migraine", "偏头痛", "migraine", ["migraine headache"], "神经精神"),
    ("depression", "抑郁症", "major depressive disorder", ["MDD", "depression", "major depression"], "神经精神"),
    ("schizophrenia", "精神分裂症", "schizophrenia", [], "神经精神"),
    ("bipolar", "双相障碍", "bipolar disorder", ["bipolar I disorder", "manic depression", "manic episodes"], "神经精神"),
    ("anxiety", "焦虑症", "anxiety disorder", ["generalized anxiety disorder"], "神经精神"),
    ("insomnia", "失眠", "insomnia", ["sleep disorder"], "神经精神"),
    ("adhd", "注意缺陷多动障碍", "attention deficit hyperactivity disorder", ["ADHD"], "神经精神"),
    ("als", "肌萎缩侧索硬化", "amyotrophic lateral sclerosis", ["ALS", "Lou Gehrig's disease"], "神经精神"),
    ("huntingtons", "亨廷顿病", "Huntington's disease", ["Huntington disease", "chorea"], "神经精神"),
    # 自免炎症
    ("rheumatoid-arthritis", "类风湿关节炎", "rheumatoid arthritis", [], "自免炎症"),
    ("psoriasis", "银屑病", "psoriasis", ["plaque psoriasis"], "自免炎症"),
    ("psoriatic-arthritis", "银屑病关节炎", "psoriatic arthritis", ["PsA"], "自免炎症"),
    ("ankylosing-spondylitis", "强直性脊柱炎", "ankylosing spondylitis", [], "自免炎症"),
    ("sle", "系统性红斑狼疮", "systemic lupus erythematosus", ["SLE", "lupus"], "自免炎症"),
    ("atopic-dermatitis", "特应性皮炎", "atopic dermatitis", ["eczema"], "自免炎症"),
    ("sjogrens", "干燥综合征", "Sjogren's syndrome", ["Sjogren syndrome", "sicca syndrome"], "自免炎症"),
    ("myasthenia-gravis", "重症肌无力", "myasthenia gravis", ["generalized myasthenia gravis", "gMG"], "自免炎症"),
    # 感染
    ("hiv", "HIV感染", "human immunodeficiency virus", ["HIV", "HIV-1 infection", "AIDS"], "感染"),
    ("influenza", "流感", "influenza", ["flu", "influenza virus"], "感染"),
    ("covid-19", "新冠", "COVID-19", ["SARS-CoV-2", "coronavirus disease 2019"], "感染"),
    ("herpes-zoster", "带状疱疹", "herpes zoster", ["shingles", "zoster"], "感染"),
    ("aspergillosis", "曲霉病", "aspergillosis", ["invasive aspergillosis"], "感染"),
    ("tuberculosis", "结核病", "tuberculosis", ["TB", "Mycobacterium tuberculosis"], "感染"),
    ("malaria", "疟疾", "malaria", ["Plasmodium falciparum"], "感染"),
    ("rsv", "呼吸道合胞病毒", "respiratory syncytial virus", ["RSV"], "感染"),
    ("cmv", "巨细胞病毒", "cytomegalovirus", ["CMV"], "感染"),
    # 肾泌尿
    ("ckd", "慢性肾病", "chronic kidney disease", ["CKD", "chronic renal disease", "chronic renal failure"], "肾泌尿"),
    ("overactive-bladder", "膀胱过度活动症", "overactive bladder", ["OAB", "urge urinary incontinence"], "肾泌尿"),
    ("bph", "前列腺增生", "benign prostatic hyperplasia", ["BPH", "prostatic hypertrophy"], "肾泌尿"),
    # 血液
    ("anemia", "贫血", "anemia", ["iron deficiency anemia", "anemia of chronic disease"], "血液"),
    ("hemophilia", "血友病", "hemophilia", ["hemophilia A", "hemophilia B", "haemophilia"], "血液"),
    ("thrombocytopenia", "血小板减少症", "thrombocytopenia", ["immune thrombocytopenia", "ITP", "low platelet"], "血液"),
    ("sickle-cell", "镰状细胞病", "sickle cell disease", ["sickle cell anemia"], "血液"),
    # 眼科
    ("amd", "年龄相关性黄斑变性", "macular degeneration", ["AMD", "age-related macular degeneration", "wet AMD", "neovascular AMD"], "眼科"),
    ("diabetic-retinopathy", "糖尿病视网膜病变", "diabetic retinopathy", ["diabetic macular edema", "DME"], "眼科"),
    ("glaucoma", "青光眼", "glaucoma", ["open-angle glaucoma", "ocular hypertension"], "眼科"),
    ("dry-eye", "干眼症", "dry eye disease", ["dry eye syndrome", "keratoconjunctivitis sicca"], "眼科"),
    # 其他
    ("pain", "疼痛管理", "chronic pain", ["severe pain", "moderate to severe pain", "neuropathic pain"], "其他"),
    ("opioid-dependence", "阿片依赖", "opioid dependence", ["opioid use disorder", "opioid addiction"], "其他"),
    ("smoking-cessation", "戒烟", "smoking cessation", ["quit smoking", "nicotine dependence"], "其他"),
    ("cinv", "化疗恶心呕吐", "chemotherapy-induced nausea and vomiting", ["CINV", "chemotherapy induced nausea"], "其他"),
    ("gvhd", "移植物抗宿主病", "graft-versus-host disease", ["GVHD", "graft versus host disease"], "其他"),
    ("transplant-rejection", "移植排斥", "organ transplant rejection", ["prophylaxis of organ rejection", "transplant rejection"], "其他"),
]


def export_disease(conn, slug, name_zh, name_en, synonyms):
    """对单个疾病跑完整管道，返回 (index_entry, detail_dict) 或 None。"""
    terms = [name_en] + synonyms
    keywords = {s.strip().lower() for s in terms}
    q = fts_query(terms)

    rows = conn.execute(
        """
        SELECT l.id, l.set_id, l.application_number, l.brand_name,
               l.generic_name, l.effective_time, l.has_boxed_warning
        FROM indications_fts f
        JOIN labels l ON l.id = f.rowid
        WHERE indications_fts MATCH ?
        """,
        (q,),
    ).fetchall()

    # 按 application_number 去重，取最新 effective_time
    best = {}
    for r in rows:
        appno = r[2]
        if not appno:
            continue
        if appno not in best or (r[5] or "") > (best[appno][5] or ""):
            best[appno] = r

    drugs = []
    for appno, r in sorted(best.items()):
        overview = conn.execute(
            """
            SELECT drug_name, active_ingredient, sponsor_name, appl_type,
                   MIN(approval_date)
            FROM drugs.v_drug_overview
            WHERE application_number = ?
            GROUP BY application_number
            """,
            (appno,),
        ).fetchone()
        if not overview:
            continue
        status = conn.execute(
            """
            SELECT marketing_status FROM drugs.v_drug_overview
            WHERE application_number = ?
            ORDER BY (approval_date IS NULL), approval_date DESC
            LIMIT 1
            """,
            (appno,),
        ).fetchone()
        drug_name, ingredient, sponsor, appl_type, first_approval = overview
        brand_min = conn.execute(
            "SELECT MIN(approval_date) FROM drugs.v_drug_overview WHERE UPPER(drug_name) = UPPER(?)",
            (drug_name or r[3] or "",),
        ).fetchone()
        if brand_min and brand_min[0]:
            first_approval = brand_min[0]

        deep = conn.execute(
            "SELECT boxed_warning, warnings, adverse_reactions, clinical_studies "
            "FROM label_deep WHERE set_id = ?",
            (r[1],),
        ).fetchone()
        boxed_t = unpack(deep[0]) if deep else ""
        warnings_t = unpack(deep[1]) if deep else ""
        adverse_t = unpack(deep[2]) if deep else ""
        studies_t = unpack(deep[3]) if deep else ""
        snippet = efficacy_snippet(studies_t, keywords)

        drugs.append({
            "application_number": appno,
            "drug_name": drug_name or r[3] or "",
            "active_ingredient": ingredient or r[4] or "",
            "sponsor_name": sponsor or "",
            "appl_type": appl_type or "",
            "approval_date": first_approval or "",
            "marketing_status": (status[0] if status else "") or "",
            "has_boxed_warning": bool(r[6]),
            "efficacy_snippet": snippet,
            "efficacy_card": build_efficacy_card(studies_t, keywords),
            "safety_card": build_safety_card(boxed_t, warnings_t, adverse_t),
        })

    if not drugs:
        return None

    # 体积控制：超限则仅对获批日期最新的前 N 个药保留卡片
    cards_truncated = False
    est = len(json.dumps({"drugs": drugs}, ensure_ascii=False).encode("utf-8"))
    if est > SIZE_LIMIT:
        ranked = sorted(
            range(len(drugs)),
            key=lambda i: drugs[i]["approval_date"] or "",
            reverse=True,
        )
        keep = set(ranked[:CARDS_KEEP])
        for i, d in enumerate(drugs):
            if i not in keep:
                d["efficacy_card"] = None
                d["safety_card"] = None
        cards_truncated = True

    by_year = {}
    for d in drugs:
        y = (d["approval_date"] or "")[:4]
        if y and int(y) >= 1995:
            by_year[y] = by_year.get(y, 0) + 1

    newest = max((d["approval_date"] for d in drugs if d["approval_date"]), default="")
    newest_name = next(
        (d["drug_name"] for d in drugs if d["approval_date"] == newest), ""
    )
    boxed = sum(1 for d in drugs if d["has_boxed_warning"])

    index_entry = {
        "slug": slug,
        "name_zh": name_zh,
        "name_en": name_en,
        "area": DISEASE_AREAS[slug],
        "synonyms": synonyms,
        "drug_count": len(drugs),
        "newest_approval": newest,
        "newest_drug": newest_name,
        "boxed_count": boxed,
    }
    detail = {
        "slug": slug,
        "name_zh": name_zh,
        "name_en": name_en,
        "synonyms": synonyms,
        "area": DISEASE_AREAS[slug],
        "approvals_by_year": dict(sorted(by_year.items())),
        "cards_truncated": cards_truncated,
        "drugs": drugs,
    }
    return index_entry, detail


DISEASE_AREAS = {slug: area for slug, _, _, _, area in DISEASES}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_LABELS)
    conn.execute(f"ATTACH DATABASE '{DB_DRUGS}' AS drugs")

    index = []
    skipped = []
    total_bytes = 0
    max_drugs = ("", 0)
    cards_stats = [0, 0]  # [有卡药物数, 药物总数]
    truncated_list = []
    t0 = time.time()

    for slug, name_zh, name_en, synonyms, area in DISEASES:
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            # 断点续跑：已导出的疾病跳过（从文件恢复 index 条目）
            try:
                with open(out_path, encoding="utf-8") as f:
                    detail = json.load(f)
                drugs = detail["drugs"]
                newest = max((d["approval_date"] for d in drugs if d["approval_date"]), default="")
                index.append({
                    "slug": slug, "name_zh": name_zh, "name_en": name_en, "area": area,
                    "synonyms": synonyms,
                    "drug_count": len(drugs), "newest_approval": newest,
                    "newest_drug": next((d["drug_name"] for d in drugs if d["approval_date"] == newest), ""),
                    "boxed_count": sum(1 for d in drugs if d["has_boxed_warning"]),
                })
                total_bytes += os.path.getsize(out_path)
                if len(drugs) > max_drugs[1]:
                    max_drugs = (f"{name_zh}({slug})", len(drugs))
                cards_stats[0] += sum(1 for d in drugs if d.get("efficacy_card") or d.get("safety_card"))
                cards_stats[1] += len(drugs)
                if detail.get("cards_truncated"):
                    truncated_list.append((slug, name_zh, len(drugs)))
                print(f"  ↷ {slug:24s} {name_zh} 已存在，跳过", flush=True)
                continue
            except Exception:
                pass  # 文件损坏则重新导出
        t1 = time.time()
        result = export_disease(conn, slug, name_zh, name_en, synonyms)
        if result is None:
            skipped.append((slug, name_zh, name_en))
            print(f"  ✗ {slug:24s} {name_zh} 命中 0，剔除", flush=True)
            continue
        entry, detail = result
        index.append(entry)
        payload = json.dumps(detail, ensure_ascii=False, separators=(",", ":"))
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(payload)
        total_bytes += len(payload.encode("utf-8"))
        if entry["drug_count"] > max_drugs[1]:
            max_drugs = (f"{name_zh}({slug})", entry["drug_count"])
        n_cards = sum(
            1 for d in detail["drugs"] if d["efficacy_card"] or d["safety_card"]
        )
        cards_stats[0] += n_cards
        cards_stats[1] += len(detail["drugs"])
        if detail.get("cards_truncated"):
            truncated_list.append((slug, name_zh, entry["drug_count"]))
        print(
            f"  ✓ {slug:24s} {name_zh:12s} drugs={entry['drug_count']:4d} "
            f"cards={n_cards:4d}  ({time.time()-t1:.1f}s)"
            + ("  [TRUNCATED]" if detail.get("cards_truncated") else ""),
            flush=True,
        )

    # index.json：按治疗领域分组顺序排列
    areas_order = []
    for _, _, _, _, area in DISEASES:
        if area not in areas_order:
            areas_order.append(area)
    index.sort(key=lambda e: (areas_order.index(e["area"]), -e["drug_count"]))
    index_payload = json.dumps(
        {"areas": areas_order, "diseases": index},
        ensure_ascii=False, separators=(",", ":"),
    )
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        f.write(index_payload)
    total_bytes += len(index_payload.encode("utf-8"))

    # app_index.json：application_number → [{slug, name_zh}]（药品→疾病反向索引）
    name_map = {e["slug"]: e["name_zh"] for e in index}
    app_index: dict[str, list[str]] = {}
    for e in index:
        with open(os.path.join(OUT_DIR, f"{e['slug']}.json"), encoding="utf-8") as f:
            detail = json.load(f)
        for d in detail["drugs"]:
            app_index.setdefault(d["application_number"], []).append(e["slug"])
    app_payload = json.dumps(
        {
            app: [{"slug": s, "name_zh": name_map[s]} for s in sorted(slugs)]
            for app, slugs in app_index.items()
        },
        ensure_ascii=False, separators=(",", ":"),
    )
    with open(os.path.join(OUT_DIR, "app_index.json"), "w", encoding="utf-8") as f:
        f.write(app_payload)
    total_bytes += len(app_payload.encode("utf-8"))
    print(
        f"app_index.json: {len(app_index)} 键, "
        f"{len(app_payload.encode('utf-8'))/1024/1024:.2f} MB"
    )

    print("\n===== 导出汇总 =====")
    print(f"词表疾病: {len(DISEASES)}  导出: {len(index)}  剔除: {len(skipped)}")
    for s in skipped:
        print(f"    剔除: {s[1]}({s[0]})")
    print(f"卡片覆盖率: {cards_stats[0]}/{cards_stats[1]} ({cards_stats[0]/max(cards_stats[1],1)*100:.1f}%)")
    if truncated_list:
        print(f"卡片截断疾病（仅前 {CARDS_KEEP} 个新药有卡）:")
        for slug, zh, n in truncated_list:
            print(f"    {zh}({slug}) drugs={n}")
    else:
        print("卡片截断疾病: 无")
    print(f"JSON 总体积: {total_bytes/1024/1024:.2f} MB")
    print(f"单疾病最大药物数: {max_drugs[0]} = {max_drugs[1]}")
    print(f"耗时: {time.time()-t0:.0f}s")
    conn.close()


if __name__ == "__main__":
    main()

// 中文规则词典：条件抽取与证据事实分类共用。
// 仅做基于词表的规则匹配，不做模糊相似度，避免把“参与培训、未参与上线”误判为交付经验。

export const PRIORITY_MARKERS = {
  preferred: ['非必需', '优先', '加分', '择优'],
  mandatory: ['必备', '必须', '须有', '须', '应当', '要求'],
};

// 条件概念词表：条件 -> 概念 key（顺序即匹配优先级，具体概念排在宽泛概念之前）
export const CONDITION_CONCEPTS = {
  certificate: ['证书', '职业资格', '持证'],
  acceptance_record: ['验收记录', '独立验收', '验收'],
  full_delivery: ['完整交付', '交付项目', '独立完成', '完整项目', '项目交付'],
  launch: ['上线', '投产', '发布'],
  training: ['培训', '实训'],
  experience_years: ['经历', '年限', '年经验', '工作经验', '从业'],
};

// 事实概念词表：事实文本 -> 概念 key（顺序即匹配优先级，具体概念排在宽泛概念之前）
export const FACT_CONCEPTS = {
  certificate: ['证书', '资格'],
  acceptance_record: ['验收记录', '验收', '评审', '交付评审'],
  launch: ['上线', '投产', '发布'],
  training: ['培训', '实训'],
  full_delivery: ['交付', '完整项目', '项目'],
  experience_years: ['年限', '年', '经历', '从业'],
};

// 生命周期阶段；具体阶段排在“开发/实施”之前，避免“上线”被开发类词抢先命中。
export const LIFECYCLE_STAGES = [
  ['training', ['培训', '实训', '实习']],
  ['review', ['评审']],
  ['acceptance', ['验收']],
  ['launch', ['上线', '投产', '发布']],
  ['development', ['开发', '实施', '执行']],
];

// 归属线索
export const SELF_MARKERS = ['我独立', '独立', '本人', '我组织', '我负责', '我完成', 'A1 独立', 'A1 组织', 'A1 负责'];
export const TEAM_MARKERS = ['团队', '小组', '同事', '协作', '共同', '另有'];
export const NEGATION_MARKERS = ['未参与', '没有参与', '未负责', '未执行', '并未', '没有', '未'];
export const ATTESTATION_MARKERS = ['证明', '证实', '记录', '节录', '兹证明'];
export const PERIOD_MARKERS = ['期间', '暑期', '年', '月', '时间为'];
export const CAPABILITY_MARKERS = ['能力', '技能', '能够', '掌握', '负责', '组织'];

// 替代关系线索
export const ALTERNATIVE_MARKERS = ['或', '或者', '可替代', '替代', '也可', '即可'];
// 前提/门槛线索
export const GATE_MARKERS = ['须有', '必须', '前提', '还要', '另需', '须'];
// 澄清线索（条件本身无法凭文本确认，需企业澄清）
export const CLARIFICATION_MARKERS = ['等', '相关', '适当', '相当', '若干', '同类'];

export function findConcept(term, dictionary = CONDITION_CONCEPTS) {
  for (const [concept, words] of Object.entries(dictionary)) {
    if (words.some((w) => term.includes(w))) return concept;
  }
  return null;
}

export function includesAny(text, words) {
  return words.some((w) => text.includes(w));
}

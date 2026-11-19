# 就业辅导中的岗位要求释义与证据授权（本地辅导工具）

一个纯 Node.js 标准库实现的本地 CLI，帮助就业辅导员和毕业生回答三类问题：

1. 招聘说明里哪些要求是**必备、优先、可替代、带前提、需要企业澄清**的（保留原句定位）；
2. 手头简历、自述、证明材料能证明哪一部分（**本人完成 / 团队完成 / 相关但未发生 / 可证明期间与能力**）；
3. 同一段证据在**辅导视角**和**对外申请视角**下分别能不能用——按每份材料的授权对象、用途和 `shareable` 事实范围重新检查。

> 本工具用于辅导与申请材料准备，**录用仍由企业决定**。所有数据保存在本地 JSON 工作区，不联网、不外发。

## 资料约定

原始资料沿用 `data/inputs.json`：

- `postings`：招聘说明与其后的企业补充答复（`responseTo` 关联原帖）；
- `statements`：独立交来的经历文字（简历 / 自述 / 证明 / 公开证明节录）；
- `permissions`：材料可见对象（`readers`）和用途（`uses`）。**未列出的对象或用途没有许可**；
  带 `shareable` 时，许可对象可引用的内容限于该字段所述事实，其余原文仅对学生和辅导员开放。

运行 `npm run init` 后生成工作区（默认 `./workspace.json`，已在 `.gitignore` 忽略），在原始字段之外扩展出
`conditions`、`facts`、`projectLinks`、`reviewFlags`、`applications`、`audit` 等工具状态，原始字段保持不动。

## 快速开始

```sh
npm run inspect:data   # 读取原始资料并列出记录数
npm test               # 16 项规则测试 + 原始资料完整性检查
npm run demo           # 端到端演示完整辅导流程（使用临时工作区，结束自动清理）
```

手动使用：

```sh
node src/cli.mjs init --from data/inputs.json --to workspace.json
node src/cli.mjs conditions --workspace workspace.json
node src/cli.mjs facts --workspace workspace.json
node src/cli.mjs link --workspace workspace.json --student A1 --project 星港 --statements S1,S2,S3,S4
node src/cli.mjs review --workspace workspace.json
node src/cli.mjs compare --workspace workspace.json --student A1
node src/cli.mjs gaps --workspace workspace.json --student A1 --audience application
node src/cli.mjs auth-matrix --workspace workspace.json --student A1
node src/cli.mjs --help   # 全部命令
```

## 核心业务规则

### 1. 条件抽取（`src/extract.mjs`）

- 每条条件记录来源帖子、原句起止偏移与摘录（`locator`），可回溯到招聘原文；
- “两年经历 **或** 独立完成完整交付项目”进入同一**选项组（OR，满足其一即可）**；
- “项目可替年限，**须有**独立验收记录”中的验收记录被识别为**带前提条件**，约束整组替代路径；
- “非必需/优先”归为优先条件，缺失不影响必备资格结论；
- 含“相关/等/相当”等开放口径的条件标记 `needsClarification`，提示先请企业澄清；
- 独立的“另须……”句子是独立必备条件，不会被误当前提。

### 2. 证据事实分级（`src/evidence.mjs`）

不做相似词匹配，按规则词表把文字拆成结构化事实：

| 类型 | 含义 | 例子 |
| --- | --- | --- |
| `event` + `role=self` | 本人完成（含独立/本人线索） | “A1 独立组织星港交付验收” |
| `event` + `role=team` | 团队完成，本人独立部分未证明 | “团队已验收”“参与项目培训” |
| `non_event` | 相关但**未发生**，永远不能支持条件 | “我未参与上线” |
| `period` | 可证明的期间 | “执行期间为暑期” |
| `capability` | 能力/职责 | “负责/组织/掌握……” |
| `project_identity` | “讲的是同一项目”的说明，只用于关联、不参与匹配 | S3 |

培训/实训是单点事件，**不折算工作年限、不抬升为交付经验**；无独立线索的团队表述保守归为团队层面。

### 3. 同一项目与辅导员复核（`src/review.mjs`）

- 学生可用 `link` 说明多份材料讲的是同一项目，关联后才做跨材料比对；
- 同一项目同一阶段出现“独立完成 vs 团队完成”或“本人完成 vs 未参与”的互斥/存疑说法，
  进入复核队列（`review`），由辅导员 `resolve-review` 记录采信结论，工具不自行裁决。

### 4. 判定与路径比较（`src/assess.mjs`）

结论只有三档：**符合 / 可能符合 / 无法凭现有来源判断**。

- 选项组内满足其一即可（OR），独立必备条件全部满足才行（AND），优先条件单列；
- 带前提的路径，前提不满足时整条路径不成立；
- 证明材料支持的本人事实可判符合；仅自述/简历支持的判可能符合并指出缺证明；
- 同一段经历在同一选项组内、或前提与主选项之间共用是允许的；
  **跨两个明确不可合用的条件重复充当同一段经历会报警**，必须另找证据或放弃其一；
- `compare` 并排给出辅导视角与对外视角：对辅导员成立的路径，在对外材料中按授权重新检查，可能不成立。

### 5. 授权裁剪与申请摘要（`src/authz.mjs`、`src/applications.mjs`）

- 对外视角只使用授权给 `employer + application` 的材料；`shareable` 之外的事实（如“暑期”这一期间细节）不可引用；
- 学生只同意给老师看的证明（如 S2），辅导员可见全文，但**不会写进外发副本**；
- 摘要逐句登记来源事实、授权状态与“部分证明”标记：**只能证明一部分的句子禁止写成已满足整条条件**，发送前校验拦截；
- `send` 保存当时授权范围与证据的**快照**；之后授权撤回或企业补充条件时用 `rejudge-app` 逐句重判：
  - 未发送草稿：剔除失据句、保留仍有依据的内容；
  - 已发送版本：快照保留可查，受影响句子标记 `needs_correction_notice`，提醒向企业更正；
- `withdraw` 记录撤回前后的 `readers/uses` 变化并进入审计留痕（`audit`）。
- 企业补充“项目可替年限，但还要独立验收记录”时，即使学生资格没变，
  已准备的申请摘要也要按新条件重判哪些语句仍有授权且证据充分（见 `data/strict.json` 场景与第 13 项测试）。

## 目录结构

```
src/
  keywords.mjs     中文规则词表（条件/事实概念、归属、否定、阶段、替代、前提线索）
  util.mjs         ID、原句定位、原子写文件等通用辅助
  store.mjs        本地 JSON 工作区读写与审计入口
  extract.mjs      招聘条件抽取与选项组/前提建模
  evidence.mjs     陈述文字 -> 结构化事实（五类分级）
  review.mjs       同一项目关联、冲突复核队列、重复使用检测
  authz.mjs        readers/uses/shareable 授权判定
  assess.mjs       三档结论判定引擎、双视角、缺口报告数据
  applications.mjs 申请摘要、发送快照、撤回与逐句重判
  report.mjs       中文文本报告
  cli.mjs          命令行入口
scripts/
  inspect.mjs      原始资料记录数检查
  demo.mjs         端到端演示
test/
  inputs.test.mjs  原始资料字段与引用完整性
  rules.test.mjs   16 项业务规则测试
data/
  inputs.json      合成案例（主场景）
  strict.json      企业补充独立验收记录后的严格场景
```

## 设计边界

- 规则基于中文词表与句式线索，目的是**避免相似词误判**（如把“参与培训、未参与上线”当交付经验）；
  新岗位用语可直接在 `src/keywords.mjs` 扩充词表；
- 工具不替企业或辅导员做事实认定：归属疑问、冲突、开放口径一律留待人工核实/澄清；
- 所有结论都带证据链与原句定位，便于向学生说明“缺什么、可以补什么、哪些材料可以给谁看”。

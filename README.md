# 就业辅导中的岗位要求释义与证据授权

postings 保存招聘说明与其后答复。statements 保存独立交来的经历相关文字。permissions 给出材料可见对象和用途，未列出的对象或用途没有许可。有 shareable 时，许可对象可引用的内容限于字段所述事实，其余原文仅对学生和辅导员开放。

资料保存在 `data/inputs.json`，采用 UTF-8 JSON。记录、人员、地点和业务编号均为合成内容。

运行环境为 Node.js 22.23.4，资料工具和测试使用 Node.js 标准库。

```sh
npm run inspect:data
npm test
```

`inspect:data` 读取资料并列出记录数。测试核对该批资料的字段和引用完整性。

# Change 内容与示例

## 模板

Change 文件使用 [change.md](../templates/change.md) 建立。模板定义 frontmatter、一级标题、关联规范和三个二级分节的文件结构；本文件定义生命周期、内容语义和完整实例。

## 状态

- `proposed`：目标尚待确认。
- `accepted`：目标及关联规范已确认，完成条件尚未全部满足。
- `completed`：实现和实际验证完成，全部受影响规范已同步并通过内容核对，索引已生成并检查。
- `cancelled`：变更已经终止。

`proposed` 和 `accepted` Change 记录目标差异；`completed` Change 保存完成时的历史差异。确认目标时确定全部待更新规范，验证通过后同步并核对，完成步骤见 [usage.md](usage.md#完成)。

## 验证证据

实现正确性由实际测试输出或项目已有验证记录判定。Change 只记录规范差异和生命周期，不保存实施计划、任务状态、测试命令或运行输出。缺少实际验证证据时不得标记 `completed`。

## 时间

- `created_at` 是 Change 创建时的北京时间，所有状态必须填写，创建后保持不变。
- `completed_at` 是 Change 完成时的北京时间。`completed` 状态必须填写，`proposed`、`accepted` 和 `cancelled` 状态保持为空。
- 两个字段使用 `YYYY-MM-DD HH:mm:ss` 格式，不附带时区；时间按北京时间解释。
- `completed_at` 不得早于 `created_at`。

## 关联规范

`关联规范：` 在创建 Change 时填写，确认目标时覆盖全部受影响规范。使用仓库内 Markdown 文件的相对链接或具体 REQ ID：已有需求引用 REQ ID，新增需求引用目标 `requirements.md` 或相关 Project 文档。关联规范定义同步范围，完成情况以内容核对为准。

跨域变更使用一份 Change，放在主领域，并引用每个受影响领域的规范。`proposed` 和 `accepted` Change 的关联规范必须指向当前存在的文件或 REQ ID；`completed` 和 `cancelled` Change 的关联按完成或终止时的内容解释。

## 内容要求

- 一级标题说明本次规范变更的主题。
- `变更原因` 的第一个段落用一句话概述变更目的，并作为变更索引中的摘要；后续段落可以补充业务问题、约束和背景。
- `变更前` 完整描述受影响的当前规则；新增功能写明当前不存在对应能力。
- `变更后` 写明目标规则、输入输出、判断条件、状态变化、错误结果、必要设计及相关边界。
- 影响数据处理结果的变更提供完整输入、中间状态和最终输出。

## 完整示例

```markdown
---
status: completed
created_at: 2026-03-25 09:30:00
completed_at: 2026-03-25 11:00:00
---

# 收紧账户购买资格判定

关联规范：[账户需求](../requirements.md)、BILL-REQ-001

## 变更原因

购买资格需要严格依据账户激活状态，避免非布尔值被解释为有效状态。

## 变更前

账户对象存在时允许购买，`active` 的类型和值不影响结果。

| 输入 | 结果 |
| --- | --- |
| `{"active":false}` | `true` |
| `{"active":1}` | `true` |
| `null` | `false` |

## 变更后

仅当 `active` 严格等于布尔值 `true` 时允许购买。缺少 `active`、类型错误或值为 `false` 时均返回 `false`。

| 输入 | 结果 |
| --- | --- |
| `{"active":true}` | `true` |
| `{"active":false}` | `false` |
| `{"active":1}` | `false` |
| `{"active":"true"}` | `false` |
| `{}` | `false` |
| `null` | `false` |
```

---
name: spec-coding
description: "在明确采用 Spec Coding、项目已有 Spec 文档，或需要为软件系统建立开发规范时使用。按领域维护 Project / Domain 当前规范、Change 和导航索引，以规则和数据示例指导实现与验证，并区分当前有效规范与历史变更。"
---

# Spec Coding

## 职责

维护 Project / Domain 当前规范、Change 和导航索引。需求说明功能用途、处理规则、完整数据过程和边界行为；Domain 采用领域建模方法；Change 说明规范变更的状态、原因和前后差异。

## 边界

- Project / Domain 文档表达已经生效并经过验证的当前规范；`proposed` 和 `accepted` Change 表达尚未生效的目标差异；`completed` Change 保存完成时的历史差异。
- 本 Skill 不维护实施计划、任务状态或测试输出，不规定通用编码、测试、调试和评审方法。
- 脚本检查目录、结构、字段、引用和索引一致性；业务语义、正文充分性、示例正确性及当前规范的同步情况由代理核对。

## 按场景读取

| 场景 | 读取材料 |
| --- | --- |
| 初始化 | [spec-structure.md](references/spec-structure.md)、[domain-modeling.md](references/domain-modeling.md)、对应 Project / Domain 模板及 [usage.md](references/usage.md#初始化) |
| 既有项目补齐 | [existing-project-spec-audit.md](references/existing-project-spec-audit.md)、当前任务相关源码与规范 |
| 编写需求 | 相关当前规范、[requirements-entry-format.md](references/requirements-entry-format.md)、[domain-requirements.md](templates/domain-requirements.md) |
| 编写 Change | 相关当前规范、[domain-modeling.md](references/domain-modeling.md#同步规则)、[change-entry-format.md](references/change-entry-format.md)、[change.md](templates/change.md) |
| 完成 Change | 本次 Change、全部关联当前规范、[domain-modeling.md](references/domain-modeling.md#同步规则)、[usage.md](references/usage.md#完成) |
| 编号、索引和检查 | [spec-structure.md](references/spec-structure.md)、[usage.md](references/usage.md) 的对应部分 |
| 恢复开发 | 当前需求、本次 Change、相关源码差异和测试状态 |

按场景读取表中材料，并补充与目标相关的当前规范、源码和测试；历史 Change 只在需要了解变更原因时读取。

## 开发流程

获得开始执行的确认后，从当前待执行步骤继续，沿用会话中已经核实的目标、同步范围和 Change 编号。仅在相关信息缺失或出现变化证据时补充检查。

1. **确定目标**：定位领域，读取相关当前规范、本次 Change、源码和测试；存在语义差异时调查事实。确认目标时，逐项确定需要更新的 `requirements.md`、`overview.md`、`design.md` 及 Project 文档。
2. **记录差异**：规范发生实质变化时，在 `proposed` 或 `accepted` Change 中记录目标规则、必要设计及全部受影响的 `关联规范`。目标、设计或同步范围变化时更新 Change 并重新确认；当前规范在实际验证通过后同步。
3. **实施与验证**：根据 Change、当前需求和数据示例完成实现与实际验证；具体方法由对应开发和质量 Skill 负责。
4. **完成 Change**：实际验证通过后，同步已确认的全部受影响规范，并重新读取 Change 和当前规范逐项核对。核对通过后填写完成时间、标记 `completed`，再统一生成和检查索引；存在遗漏、冲突或尚未验证的规则时保持 `accepted`。具体操作见 [usage.md](references/usage.md#完成)。

## Change 创建条件

Change 适用于功能、规则、公共接口及长期约束的新增、修改和取消。违反现有需求的实现修复、保持行为的代码整理、文档格式修正和现状规范初始化属于现有规范维护。

Change 生命周期、关联规范、内容要求和完整实例见 [change-entry-format.md](references/change-entry-format.md)。

## 完成条件

- 必备文件和目录完整，Project / Domain 文档使用对应模板；当前任务所需内容真实且充分。
- 需求按功能组织，共享规则单处定义，条目顺序与引用符合 [需求与引用规则](references/spec-structure.md#需求与引用)。
- 需求规则、正常数据过程和相关边界示例相互一致，实际实现及必要回归已有验证依据。
- 当前规范完整表达本次 Change 的已生效规则及必要设计，定义或引用明确，相关旧内容与当前规则一致。
- Change 准确表达目标差异或历史差异；`completed` 以实际验证、规范同步和内容核对通过为前提。
- 结构与索引检查、规范与示例的内容核对均通过；结构检查不能代替内容核对。

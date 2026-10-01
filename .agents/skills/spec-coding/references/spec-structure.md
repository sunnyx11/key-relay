# `specs` 文档结构

默认 Spec 目录为 `specs/`，命令支持仓库内相对目录 `--specs-dir`。操作见 [usage.md](usage.md)，领域建模见 [domain-modeling.md](domain-modeling.md)，需求内容见 [requirements-entry-format.md](requirements-entry-format.md)，Change 内容见 [change-entry-format.md](change-entry-format.md)。

## 目录

```text
specs/
├── index.md
├── changes.md
├── requirements-index.md
├── project/
│   ├── context.md
│   ├── principles.md
│   ├── architecture.md
│   └── glossary.md
└── domains/
    └── <domain>/
        ├── overview.md
        ├── requirements.md
        ├── design.md
        └── changes/
            └── <NNN>-change.md
```

Project 四份文件、每个 Domain 三份文件及 `changes/` 目录必须存在，`changes/` 目录允许为空。至少建立一个已经识别的 Domain；目录名称使用小写字母、数字和短横线，按一级目录组织。

## 文件职责

| 文件 | 内容 | 模板 |
| --- | --- | --- |
| `project/context.md` | 背景、用途、系统目标、主要能力和技术环境 | [project-context.md](../templates/project-context.md) |
| `project/principles.md` | 项目特有的技术、安全、数据、测试、性能和兼容约束 | [project-principles.md](../templates/project-principles.md) |
| `project/architecture.md` | 系统组成、领域关系、整体数据流、集成与部署 | [project-architecture.md](../templates/project-architecture.md) |
| `project/glossary.md` | 统一术语、定义和所属领域 | [project-glossary.md](../templates/project-glossary.md) |
| `domains/<domain>/overview.md` | 领域目标、职责边界、核心概念和领域间关系 | [domain-overview.md](../templates/domain-overview.md) |
| `domains/<domain>/requirements.md` | 当前有效需求、处理规则、数据示例和边界行为 | [domain-requirements.md](../templates/domain-requirements.md) |
| `domains/<domain>/design.md` | 当前领域模型、实现结构、接口、数据模型和技术决策 | [domain-design.md](../templates/domain-design.md) |
| `domains/<domain>/changes/<NNN>-change.md` | 一次需求变更的状态、创建与完成时间、关联规范、原因和前后差异 | [change.md](../templates/change.md) |

Project / Domain 文档表达已经生效并经过验证的当前规范，Change 的生命周期和内容语义见 [change-entry-format.md](change-entry-format.md)。

## Change 编号

- 文件名严格为 `<NNN>-change.md`，序号为 `001` 至 `999`。
- 序号在单个 Domain 内唯一，允许间隔；已有编号保持稳定。不同 Domain 可以使用相同序号。
- 空目录返回 `001`，其余返回最大序号加一。最大序号为 `999` 时报告耗尽。
- `changes/` 保存 Change 普通文件；非法名称、子目录或其他文件类型均报错。
- 编号命令以目录内合法文件名的最大序号为依据，只读执行。已核实编号适用于该目录下的本次 Change，等待使用者确认不要求重新计算。
- 文件以排他方式创建，拒绝覆盖已有文件。目标目录变化时使用新目录的已核实编号，缺少该结果时运行编号命令；同名文件属于本次 Change 时继续处理，属于其他 Change 时重新计算编号。
- 唯一标识为 `<domain>/<NNN>`，例如 `identity/001`。标题表达主题，文件名承担编号作用。

编号稳定性依赖现有文件和版本历史；脚本只根据当前目录计算下一个序号。

## 需求与引用

需求条目结构见 [domain-requirements.md](../templates/domain-requirements.md)，内容要求和完整实例见 [requirements-entry-format.md](requirements-entry-format.md)。

REQ ID 在当前 Spec 中唯一并保持稳定，失效 ID 不得分配给其他功能。

- 每份 `requirements.md` 的条目按前缀分组，组内按数字序号升序排列；排序只调整条目位置，已有 ID 和编号空缺保持不变。
- 合并同一功能的重复条目时，保留能够继续代表该功能的主需求 ID，其余 ID 停用；完整规则、数据示例和边界情况归入主条目，共享规则使用引用。
- 条目合并、删除或标题调整时，同步当前文档和 `proposed`、`accepted` Change 中受影响的 REQ ID 与标题锚点引用，再生成索引；`completed`、`cancelled` Change 保留历史引用。

需求标题和引用的解析范围为 Markdown 正文；相对 Markdown 链接必须指向仓库内存在的文件，REQ ID 引用必须指向当前需求中已经声明的 ID。

REQ ID 存在性校验覆盖当前文档中的引用，以及 `proposed` 和 `accepted` Change 的 `关联规范：`。`completed` 和 `cancelled` Change 的引用按完成或终止时的内容解释。ID 历史复用需要结合版本历史检查。

## 索引

三个索引由 `update-specs.mjs` 生成，源文档变动后统一更新：

- `index.md`：固定标题为 `Spec 索引`，提供 Project、Domain 三份文档及索引入口。
- `changes.md`：按状态组织 Change 标识、变更目的、创建时间、完成时间和文件链接。链接文本为 `<domain>/<NNN>`，变更目的和时间字段使用其下的嵌套列表；空状态显示 `无`。变更目的取 `变更原因`的第一个段落，段落内换行和连续空白转换为空格，Markdown 链接保留链接文本。时间分别取 `created_at` 和 `completed_at`，按北京时间显示；完成时间为空时显示 `无`。
- `requirements-index.md`：按领域列出 REQ ID、标题和需求链接，领域内顺序与源需求文件一致。

索引只提供导航，生成过程不修改源文档。源文档校验失败时，三个索引保持原内容。需求索引链接使用由小写 REQ ID 和标题组成的常规 Markdown 标题锚点。

## 模板规则

- `context.md`、`principles.md`、`architecture.md`、`glossary.md`、`overview.md` 和 `design.md` 保留对应模板规定的一级、二级标题及顺序；分节内可以增加三级及更低级标题。
- `requirements.md` 保留模板一级标题，并按模板实例化零个或多个需求条目。每个条目只使用模板规定的四个三级分节，分节内可以增加四级及更低级标题；尚无有效需求时保留模板中的注释条目。
- 每个 Change 使用 [change.md](../templates/change.md) 建立，并在使用前填写全部占位内容。
- 说明性 HTML 注释可以保留，也可以在对应内容填写完成后删除。
- Project / Domain 中尚无相关内容的分节可以为空；当前任务涉及的内容必须真实且充分。

## 检查边界

| 检查类别 | 执行方式 |
| --- | --- |
| 必备文件、模板标题、编号、字段、当前引用和索引 | `update-specs.mjs` 和 `check-specs.mjs` |
| 需求划分、重复定义、条目顺序、规则充分性、示例正确性和业务语义 | 人工或代理检查 |
| ID 与编号的历史复用 | 结合版本历史检查 |

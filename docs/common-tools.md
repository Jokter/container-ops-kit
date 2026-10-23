# 常用工具

入口为首页「常用工具」工作空间，也支持 `#/tools/binlog` 和 `#/tools/json` 深链接。空间卡片和工具卡片支持整卡点击、Enter / Space；收藏按钮独立操作，收藏保存在当前浏览器。

## JSON

支持格式化、压缩、语法校验、转义、去转义、复制、下载和输出回填。处理完全在浏览器中完成。格式化 / 压缩保留原始数字字面量（包括超过 JavaScript 安全整数范围的整数）、字符串转义及重复键。转义去掉外层引号；去转义接受有或没有外层引号的 JSON 字符串，每次处理一层。

## Binlog

内置 `0b14`、`0b16`、`0b17`、`0b1a`、`2d5e`、`2d60`、`2d62`、`2d63`、`2d94` 的配置和示例。示例通过与用户输入相同的后端解析路径处理，没有预计算结果或 Python / Flask 运行时。

- 单条：HEX 大小写均可，允许空白，不接受 `0x` 前缀，单条最大 128 KiB。
- 批量：上传、拖入文本文件或粘贴，每行一条；忽略空行及以 `#` 开头的注释，保留原始行号；最多 500 条、1 MiB、50000 个输出字段。错误逐条返回，其他有效行继续处理。
- Feature 留空表示不过滤；有 `featureCause.feature` 的报文按整数值过滤，无此字段的命令保留。过滤记录仍展示字段和过滤原因。
- 每个字段展示分组、TAG、路径、业务名称、数值、枚举、单位、无效值标记和说明。大于安全整数范围的值以十进制字符串返回。
- 可导出 JSON / XLSX；XLSX 中数据是普通值，字符串不会作为公式执行。Excel 按上次解析输入导出，配置版本变更时拒绝导出，要求先重新解析。
- 根 TLV 的未知 TAG 按 2 字节 TAG + 2 字节字节长度跳过并给出提示；已知嵌套的未配置尾部字节给出提示。截断、命令不匹配、错误 TAG、重复非数组 TAG、尾部多余字节和越界计数均报错。

## 新增命令

页面可上传 / 拖入 JSON；支持原始字段数组（手填命令码和名称），或完整格式：

```json
{
  "code": "abcd",
  "name": "功率状态",
  "sample": "abcd00000005",
  "fields": [
    {"name": "cmdCode", "type": "hex", "offset": 4},
    {"name": "Handle", "type": "hex", "offset": 4},
    {"name": "power", "type": "int", "offset": 4, "label": "功率", "unit": "W", "invalidValue": 65535}
  ]
}
```

先校验，后注册。发生重复命令码时，必须在页面勾选覆盖；保存使用配置修订号检查并发冲突，不自动重试。自定义配置存在现有 SQLite 中。删除覆盖配置会恢复对应内置配置；内置配置不能直接删除。所有配置是当前 Ops Studio 实例共享的。

字段规则：

| 类型 / 属性 | 含义 |
|---|---|
| `offset` | HEX 字符数，正偶数；不是字节偏移地址 |
| `int`, `long` | 无符号大端整数，最多 16 个 HEX 字符 |
| `hex` | 原始 HEX，输出小写 |
| `ascii` | 按单字节字符解码，遇 `00` 结束 |
| `nest` | TAG + 长度 + children；长度表示字节数，`childrenLengthOffset` 默认为 4 个 HEX 字符 |
| `skip` | 消费嵌套内容但不输出 |
| `supportArray` | 根层同 TAG 可重复出现，保留全部记录 |
| `array` | 以 `lengthKey` 引用之前的 `@` 整数字段，按数量解析 children |
| `lengthKey` | 简名引用当前父级，或使用完整点分隔字段路径 |
| `label`, `desc`, `unit`, `enum`, `invalidValue` | 展示元数据；超大整数的无效值请使用十进制字符串 |

配置首字段必须为 `cmdCode`（hex / 4），且包含 `Handle`（hex）。非 nest 根字段先顺序解析，再读取根 TLV。根 TLV 固定 4 字符 TAG + 4 字符长度。`2d63` 专门按 `NodeInfoNumber`、`LineInfoNumber` 读取 NodeInfo / LineInfo。现有类型之外的压缩、校验和或其他特殊协议需要扩展 TypeScript 引擎，不能在配置中执行脚本或系统命令。

限制：最多 100 个命令、2048 个配置字段、10 层字段嵌套、每个数组 4096 项、单帧 20000 次字段读取。上传配置最大 512 KiB。服务沿用现有 API 的网络访问边界，没有新建登录体系。

## API

- `GET /api/tools/binlog/commands`：命令列表、配置、示例、修订号。
- `POST /api/tools/binlog/commands/validate`：完整命令对象；返回规范配置与冲突信息。
- `POST /api/tools/binlog/commands`：`{definition, expectedRevision: null | string}`。
- `DELETE /api/tools/binlog/commands/:code`：`{revision}`。
- `POST /api/tools/binlog/parse`：`{code, text, batch?, feature?, revision?}`。
- `POST /api/tools/binlog/export`：同解析输入，返回 XLSX。页面提交上次解析的修订号以避免静默使用更新配置。

本次验证不涉及真实 SSH、Kubernetes、Helm、Pi、CodeHub 或 Windows 启动环境。
